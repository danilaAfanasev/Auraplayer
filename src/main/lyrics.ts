// Тексты песен (G63): поиск в открытой базе текстов, кэш на диске (`lyrics.json`) и загрузка заранее.
// Запросы идут отсюда, не из рендерера. Ключа и аккаунта у базы нет; она просит в User-Agent назвать приложение и адрес проекта.
// Чистая логика (очистка запроса, выбор записи, разбор LRC) — `src/shared/lyrics.ts`.
import {
  EXACT_DURATION_SEC,
  lyricsFromRecord,
  lyricsKey,
  lyricsQuery,
  parseLyricsRecord,
  parseLyricsRecords,
  pickLyricsRecord,
  type LyricLine,
  type Lyrics,
  type LyricsQuery,
} from '../shared/lyrics';
import type { Track } from '../shared/types';
import { UPDATE_REPO } from '../shared/version';
import { classifyFetchError } from './sources/http';
import { SourceError } from './sources/types';

export const LYRICS_FILE = 'lyrics.json';
export const LYRICS_BASE = 'https://lrclib.net/api';
/** «Текста нет» перепроверяется не раньше чем через сутки: тексты в базе добавляют. Найденный текст не устаревает. */
export const NONE_RECHECK_MS = 24 * 60 * 60 * 1000;
/** База не любит нагрузку: не больше стольких запросов разом (и текущему треку, и заранее). */
export const MAX_CONCURRENT_REQUESTS = 2;
/** Поиск у базы бывает долгим (в пробе — до 25 с) — ждём не дольше. */
export const SEARCH_TIMEOUT_MS = 25_000;
/** Точный запрос либо отвечает сразу, либо база занята: ждать его дольше нет смысла — дальше поиск. */
export const EXACT_TIMEOUT_MS = 8_000;
/** Пауза перед единственным повтором поиска, когда сервер занят (5xx / 429). */
export const RETRY_DELAY_MS = 1200;
/** Записей в кэше не больше: самые давние вытесняются. */
export const MAX_CACHE_ENTRIES = 500;

const NONE: Lyrics = { kind: 'none' };

/** Один HTTP-запрос: статус и JSON тела (`null`, если тела нет или оно не JSON). Сбой сети — исключение (`SourceError`). */
export type LyricsFetch = (url: string, timeoutMs?: number) => Promise<{ status: number; json: unknown }>;

interface CacheEntry {
  at: number;
  lyrics: Lyrics;
}
export type LyricsCache = Record<string, CacheEntry>;

export interface LyricsDeps {
  fetch: LyricsFetch;
  /** Содержимое `lyrics.json` как есть (проверяется здесь). */
  readCache(): Promise<unknown>;
  writeCache(cache: LyricsCache): Promise<void>;
  now?: () => number;
  retryDelayMs?: number;
  maxConcurrent?: number;
}

export interface LyricsService {
  /** Текст трека: из кэша или из базы. Сбой сети/сервиса — исключение (не кэшируется). Этот запрос идёт вне очереди. */
  get(track: Track): Promise<Lyrics>;
  /** Загрузить заранее (текущий и следующие): тихо, ещё не начатые запросы прошлого вызова отменяются. */
  prefetch(tracks: Track[]): void;
}

/** Запрос отменён: пользователь ушёл дальше, а загрузка «заранее» ещё не начиналась. */
class Cancelled extends Error {}

interface RequestContext {
  key: string;
  /** Нужен прямо сейчас (играющий трек) — обгоняет очередь «заранее». */
  high: boolean;
}

// ---------- Кэш ----------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseLines(v: unknown): LyricLine[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const lines: LyricLine[] = [];
  for (const l of v) {
    if (!isObject(l) || typeof l.timeSec !== 'number' || !Number.isFinite(l.timeSec) || typeof l.text !== 'string') return null;
    lines.push({ timeSec: l.timeSec, text: l.text });
  }
  return lines;
}

function parseLyrics(v: unknown): Lyrics | null {
  if (!isObject(v)) return null;
  if (v.kind === 'none') return NONE;
  if (v.kind === 'plain') return typeof v.text === 'string' && v.text !== '' ? { kind: 'plain', text: v.text } : null;
  if (v.kind === 'synced') {
    const lines = parseLines(v.lines);
    if (!lines) return null;
    return typeof v.plain === 'string' && v.plain !== '' ? { kind: 'synced', lines, plain: v.plain } : { kind: 'synced', lines };
  }
  return null;
}

/** Файл кэша → записи; битые отбрасываются, целые остаются. */
export function parseCache(raw: unknown): Map<string, CacheEntry> {
  const map = new Map<string, CacheEntry>();
  if (!isObject(raw)) return map;
  for (const [key, entry] of Object.entries(raw)) {
    if (!isObject(entry) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue;
    const lyrics = parseLyrics(entry.lyrics);
    if (lyrics) map.set(key, { at: entry.at, lyrics });
  }
  return map;
}

// ---------- Очередь запросов ----------

interface Waiter {
  ctx: RequestContext;
  grant(): void;
  reject(err: Error): void;
}

/** Места под запросы: освободилось — первым получает тот, кому нужно сейчас, остальные по очереди. */
function createSlots(max: number, isStale: (ctx: RequestContext) => boolean) {
  let running = 0;
  const waiters: Waiter[] = [];
  const release = () => {
    running--;
    pump();
  };
  function pump(): void {
    while (running < max && waiters.length > 0) {
      const i = waiters.findIndex((w) => w.ctx.high);
      const [w] = waiters.splice(i < 0 ? 0 : i, 1);
      if (isStale(w.ctx)) {
        w.reject(new Cancelled());
        continue;
      }
      running++;
      w.grant();
    }
  }
  return {
    acquire(ctx: RequestContext): Promise<() => void> {
      return new Promise((resolve, reject) => {
        waiters.push({ ctx, grant: () => resolve(release), reject });
        pump();
      });
    },
  };
}

// ---------- Сервис ----------

export function createLyricsService(deps: LyricsDeps): LyricsService {
  const now = deps.now ?? Date.now;
  const retryDelay = deps.retryDelayMs ?? RETRY_DELAY_MS;
  let wanted = new Set<string>();
  const slots = createSlots(deps.maxConcurrent ?? MAX_CONCURRENT_REQUESTS, (ctx) => !ctx.high && !wanted.has(ctx.key));
  const inflight = new Map<string, { promise: Promise<Lyrics>; ctx: RequestContext }>();
  let cachePromise: Promise<Map<string, CacheEntry>> | null = null;

  const loadCache = (): Promise<Map<string, CacheEntry>> =>
    (cachePromise ??= deps
      .readCache()
      .then(parseCache)
      .catch(() => new Map<string, CacheEntry>())); // нечитаемый кэш — пустой: текст найдётся заново

  async function persist(cache: Map<string, CacheEntry>): Promise<void> {
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - MAX_CACHE_ENTRIES);
      for (const [key] of oldest) cache.delete(key);
    }
    try {
      await deps.writeCache(Object.fromEntries(cache));
    } catch {
      // Не записалось — текст всё равно есть в памяти; в следующий раз найдём заново.
    }
  }

  const isFresh = (e: CacheEntry): boolean => e.lyrics.kind !== 'none' || now() - e.at < NONE_RECHECK_MS;

  /** Запрос; `retry` — один повтор, если сервер занят. Место в очереди занято только на время самого запроса. */
  async function request(url: string, ctx: RequestContext, timeoutMs: number, retry: boolean): Promise<{ status: number; json: unknown }> {
    for (let attempt = 0; ; attempt++) {
      const release = await slots.acquire(ctx);
      let res: { status: number; json: unknown };
      try {
        res = await deps.fetch(url, timeoutMs);
      } finally {
        release();
      }
      if (res.status >= 500 || res.status === 429) {
        if (retry && attempt === 0) {
          if (retryDelay > 0) await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        throw new SourceError('unavailable');
      }
      return res;
    }
  }

  /** Точный запрос `/get`, затем поиск `/search`; результат — текст или «нет». */
  async function lookup(q: LyricsQuery, ctx: RequestContext): Promise<Lyrics> {
    const exact = new URLSearchParams({ artist_name: q.artist, track_name: q.title });
    if (q.album) exact.set('album_name', q.album);
    if (q.durationSec !== undefined) exact.set('duration', String(q.durationSec));
    // База на «такого нет» нередко отвечает «занят» (503) или молчит — это не причина отказаться: ищем поиском.
    // Нет сети — иначе: поиск не пройдёт тоже.
    const got = await request(`${LYRICS_BASE}/get?${exact}`, ctx, EXACT_TIMEOUT_MS, false).catch((err: unknown) => {
      if (err instanceof Cancelled || (err instanceof SourceError && err.kind === 'offline')) throw err;
      return null;
    });
    if (got?.status === 200) {
      const rec = parseLyricsRecord(got.json);
      const picked = rec ? pickLyricsRecord([rec], q, EXACT_DURATION_SEC) : null;
      if (picked) {
        const lyrics = lyricsFromRecord(picked);
        if (lyrics.kind !== 'none' || picked.instrumental) return lyrics;
      }
    }
    const searchUrl = `${LYRICS_BASE}/search?${new URLSearchParams({ artist_name: q.artist, track_name: q.title })}`;
    const found = await request(searchUrl, ctx, SEARCH_TIMEOUT_MS, true);
    if (found.status !== 200) throw new SourceError('unavailable');
    return lyricsFromRecord(pickLyricsRecord(parseLyricsRecords(found.json), q));
  }

  /** Одна загрузка на ключ: параллельные запросы того же трека присоединяются к идущей. */
  function resolve(key: string, q: LyricsQuery, cache: Map<string, CacheEntry>, high: boolean): Promise<Lyrics> {
    const running = inflight.get(key);
    if (running) {
      if (high) running.ctx.high = true;
      return running.promise;
    }
    const expired = cache.get(key);
    const ctx: RequestContext = { key, high };
    const promise = (async (): Promise<Lyrics> => {
      try {
        const lyrics = await lookup(q, ctx);
        cache.set(key, { at: now(), lyrics });
        await persist(cache);
        return lyrics;
      } catch (err) {
        // Просроченное «нет» при сбое сети остаётся «нет»: пользователю не нужна ошибка там, где текста и не было.
        if (expired && !(err instanceof Cancelled)) return expired.lyrics;
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, { promise, ctx });
    return promise;
  }

  return {
    async get(track) {
      const q = lyricsQuery(track);
      if (!q.artist || !q.title) return NONE;
      const key = lyricsKey(track);
      const cache = await loadCache();
      const hit = cache.get(key);
      if (hit && isFresh(hit)) return hit.lyrics;
      return resolve(key, q, cache, true);
    },

    prefetch(tracks) {
      wanted = new Set(tracks.map(lyricsKey));
      for (const track of tracks) {
        void (async () => {
          const q = lyricsQuery(track);
          if (!q.artist || !q.title) return;
          const key = lyricsKey(track);
          const cache = await loadCache();
          const hit = cache.get(key);
          if (hit && isFresh(hit)) return;
          if (!wanted.has(key)) return; // за время чтения кэша список сменился
          await resolve(key, q, cache, false);
        })().catch(() => undefined); // заранее — молча: ошибку увидит `get`, когда трек станет текущим
      }
    },
  };
}

/** Запрос к базе: JSON с таймаутом; 4xx/5xx не исключение — статус нужен сервису (404 = «нет такой записи»). */
export function createLyricsFetch(userAgent: string): LyricsFetch {
  return async (url, timeoutMs = SEARCH_TIMEOUT_MS) => {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
      });
    } catch (err) {
      throw classifyFetchError(err);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch (err) {
      if (res.ok) {
        const classified = classifyFetchError(err);
        throw classified.kind === 'unknown' ? new SourceError('unavailable') : classified;
      }
    }
    return { status: res.status, json };
  };
}

/** `User-Agent` для базы текстов: название, версия и адрес проекта. */
export const lyricsUserAgent = (version: string): string => `Aura/${version} (https://github.com/${UPDATE_REPO})`;
