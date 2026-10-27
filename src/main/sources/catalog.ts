// Каталог: «Популярное сейчас» по открытому чарту Apple Music выбранной страны и поиск по каталогу — без ключа и аккаунта.
// Метаданные — Apple RSS + iTunes lookup/search; звук — анонимно через runYtDlp (G01): сначала полная версия
// на SoundCloud (не дольше SC_LIMIT_MS), одновременно — YouTube; поиск и ссылка — одним запуском yt-dlp.
// Повторный старт, поток и скачивание — готовые адаптеры YouTube и SoundCloud. Сопоставление «трек каталога →
// звук» (с пометкой источника) хранится в userData.
import { splitArtists } from '../../shared/artistNames';
import { CATALOG_NEEDS_YOUTUBE_MESSAGE, CATALOG_NOT_FOUND_MESSAGE, makeTrackId, type CountryCode, type Track } from '../../shared/types';
import { resolveCountry } from '../country';
import { readJson, writeJson } from '../store';
import { runYtDlp } from '../ytdlp';
import { fetchJson as defaultFetchJson } from './http';
import { SourceError, type SourceAdapter, type SourceContext } from './types';
import { isScUnreachable, searchScStream, soundcloud as soundcloudAdapter } from './soundcloud';
import { classifyYtDlpError, probeStream, searchYtStream, youtube as youtubeAdapter, watchUrl, type ProbeStream, type RunYtDlp } from './youtube';

/** 100 — максимум открытого чарта: на 101 и больше сервер отвечает 500 (проверено в октябре 2026). */
export const appleRssBase = (country: CountryCode): string => `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/100`;
export const ITUNES_BASE = 'https://itunes.apple.com';
export const MATCHES_FILE = 'catalog-matches.json';

const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_DELAY_MS = 1500;
const COVER_SIZE = 600;
const SEARCH_LIMIT = 30;

const YT_CANDIDATES = 5;
/** Поиск кандидатов: запуск yt-dlp + ответ YouTube. Плеер ждёт звук каталога без таймера (в России без VPN — до минуты). */
const YT_SEARCH_TIMEOUT_MS = 60_000;
const DURATION_TOLERANCE_SEC = 10;
/** Запасной поиск (первый запрос ничего не дал): допуск длительности мягче… */
const FALLBACK_TOLERANCE_SEC = 20;
/** …а официальному аудио (канал «… - Topic», «Provided to YouTube by», «Official Audio») — ещё мягче. */
const FALLBACK_OFFICIAL_TOLERANCE_SEC = 30;
/** Звук не нашёлся — не ищем этот трек снова какое-то время; «Повторить» (`fresh`) ищет сразу. */
const MISS_TTL_MS = 10 * 60_000;
const MATCHES_LIMIT = 3000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const idStr = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : /^\d+$/.test(str(v)) ? str(v) : '');
const dateOnly = (v: unknown): string => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v));
  return m ? m[1] : '';
};

// ---------- Разбор ответов Apple ----------

export interface RssItem {
  id: string;
  name: string;
  artistName: string;
  /** `YYYY-MM-DD` */
  releaseDate: string;
  artworkUrl?: string;
  url?: string;
}

/** Песни или альбомы из Apple Music RSS (`most-played/{N}/{songs|albums}.json`) в порядке чарта. */
export function parseAppleRss(json: unknown): RssItem[] {
  const feed = isObject(json) && isObject(json.feed) ? json.feed : null;
  if (!feed || !Array.isArray(feed.results)) return [];
  const out: RssItem[] = [];
  const seen = new Set<string>();
  for (const r of feed.results) {
    if (!isObject(r)) continue;
    const id = idStr(r.id);
    const name = str(r.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const item: RssItem = { id, name, artistName: str(r.artistName) || 'Неизвестный исполнитель', releaseDate: dateOnly(r.releaseDate) };
    if (str(r.artworkUrl100).startsWith('https://')) item.artworkUrl = str(r.artworkUrl100);
    if (str(r.url).startsWith('https://')) item.url = str(r.url);
    out.push(item);
  }
  return out;
}

export interface ItunesTrack {
  trackId: string;
  collectionId: string;
  title: string;
  artist: string;
  album?: string;
  trackNumber: number;
  discNumber: number;
  durationSec?: number;
  /** `YYYY-MM-DD` */
  releaseDate: string;
  coverUrl?: string;
  pageUrl?: string;
}

/** Крупная обложка: `…/100x100bb.jpg` → `…/600x600bb.jpg`. */
export function bigArtwork(url: string): string {
  return url.replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/i, `/${COVER_SIZE}x${COVER_SIZE}bb.jpg`);
}

/** Страница без служебного `uo=4`. */
function cleanPageUrl(url: string): string | undefined {
  if (!url.startsWith('https://')) return undefined;
  return url.replace(/[?&]uo=\d+$/, '').replace(/&uo=\d+(&)/, '$1');
}

/** Песни из ответа iTunes lookup/search (альбомы и прочее пропускаются). */
export function parseItunesTracks(json: unknown): ItunesTrack[] {
  if (!isObject(json) || !Array.isArray(json.results)) return [];
  const out: ItunesTrack[] = [];
  const seen = new Set<string>();
  for (const r of json.results) {
    if (!isObject(r) || r.wrapperType !== 'track' || r.kind !== 'song') continue;
    const trackId = idStr(r.trackId);
    const title = str(r.trackName);
    if (!trackId || !title || seen.has(trackId)) continue;
    seen.add(trackId);
    const t: ItunesTrack = {
      trackId,
      collectionId: idStr(r.collectionId),
      title,
      artist: str(r.artistName) || 'Неизвестный исполнитель',
      trackNumber: typeof r.trackNumber === 'number' ? r.trackNumber : 0,
      discNumber: typeof r.discNumber === 'number' ? r.discNumber : 1,
      releaseDate: dateOnly(r.releaseDate),
    };
    const album = str(r.collectionName).replace(/\s+-\s+(Single|EP)$/i, '').trim();
    if (album) t.album = album;
    if (typeof r.trackTimeMillis === 'number' && r.trackTimeMillis > 0) t.durationSec = Math.round(r.trackTimeMillis / 1000);
    const art = str(r.artworkUrl100) || str(r.artworkUrl60);
    if (art.startsWith('https://')) t.coverUrl = bigArtwork(art);
    const page = cleanPageUrl(str(r.trackViewUrl));
    if (page) t.pageUrl = page;
    out.push(t);
  }
  return out;
}

export function itunesTrackToTrack(t: ItunesTrack): Track {
  const track: Track = {
    id: makeTrackId('catalog', t.trackId),
    source: 'catalog',
    sourceId: t.trackId,
    title: t.title,
    artist: t.artist,
    downloadable: true,
  };
  if (t.album) track.album = t.album;
  if (t.durationSec) track.durationSec = t.durationSec;
  if (t.coverUrl) track.coverUrl = t.coverUrl;
  if (t.pageUrl) track.pageUrl = t.pageUrl;
  return track;
}

/** Песня чарта: метаданные RSS, уточнённые lookup (длительность, альбом), если он есть. */
function rssSongToTrack(item: RssItem, detail?: ItunesTrack): Track {
  if (detail) {
    const track = itunesTrackToTrack(detail);
    if (!track.coverUrl && item.artworkUrl) track.coverUrl = bigArtwork(item.artworkUrl);
    return track;
  }
  const track: Track = {
    id: makeTrackId('catalog', item.id),
    source: 'catalog',
    sourceId: item.id,
    title: item.name,
    artist: item.artistName,
    downloadable: true,
  };
  if (item.artworkUrl) track.coverUrl = bigArtwork(item.artworkUrl);
  if (item.url) track.pageUrl = item.url;
  return track;
}

/** «Популярное сейчас»: песни чарта в его порядке. */
export function buildChart(songs: RssItem[], details: Map<string, ItunesTrack>): Track[] {
  return songs.map((s) => rssSongToTrack(s, details.get(s.id)));
}

/** Нормализация для сравнения названий: регистр, ё, знаки препинания. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ---------- Ограничитель частоты запросов к каталогу ----------

/** Каталог пускает около 20 запросов в минуту: больше — отказы, и у фона, и у пользователя. */
export const CATALOG_REQUESTS_PER_MINUTE = 20;
/** Фону (лента, обновление чарта) — не больше стольких мест в минуту; остальные всегда свободны для пользователя. */
export const CATALOG_BACKGROUND_PER_MINUTE = 15;

/** `user` — поиск, страница артиста, релиз; `background` — сборка ленты, обновление чарта. */
export type RequestPriority = 'user' | 'background';

export interface RateLimiter {
  /** Выполнить запрос, когда частота позволит; ждущие запросы пользователя идут раньше фоновых. */
  run<T>(priority: RequestPriority, fn: () => Promise<T>): Promise<T>;
}

export interface RateLimiterOptions {
  /** Не больше стольких запусков… */
  limit: number;
  /** …за это скользящее окно. */
  windowMs: number;
  /** Фоновым — не больше стольких запусков за окно (по умолчанию `limit`): остальное — запас пользователя. */
  backgroundLimit?: number;
  now?: () => number;
}

export function createRateLimiter({ limit, windowMs, backgroundLimit = limit, now = () => Date.now() }: RateLimiterOptions): RateLimiter {
  const bgLimit = Math.max(1, Math.min(limit, backgroundLimit));
  const started: number[] = [];
  const waiting: Record<RequestPriority, (() => void)[]> = { user: [], background: [] };
  let timer: ReturnType<typeof setTimeout> | null = null;

  function pump(): void {
    const t = now();
    while (started.length > 0 && t - started[0] >= windowMs) started.shift();
    for (;;) {
      if (waiting.user.length > 0 && started.length < limit) {
        started.push(t);
        waiting.user.shift()!();
      } else if (waiting.background.length > 0 && started.length < bgLimit) {
        started.push(t);
        waiting.background.shift()!();
      } else break;
    }
    if (timer) clearTimeout(timer);
    timer = null;
    // Ждущим нужно, чтобы из окна вышли старые запуски: пользователю — до limit, фону — до bgLimit.
    const wake: number[] = [];
    if (waiting.user.length > 0) wake.push(started[started.length - limit] + windowMs);
    if (waiting.background.length > 0) wake.push(started[started.length - bgLimit] + windowMs);
    if (wake.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, Math.max(0, Math.min(...wake) - t));
  }

  return {
    run<T>(priority: RequestPriority, fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting[priority].push(() => {
          new Promise<T>((r) => r(fn())).then(resolve, reject);
        });
        pump();
      });
    },
  };
}

/** Ограничитель с частотой каталога: 20 запросов в минуту, из них фону — не больше 15. */
export function createCatalogLimiter(): RateLimiter {
  return createRateLimiter({ limit: CATALOG_REQUESTS_PER_MINUTE, windowMs: 60_000, backgroundLimit: CATALOG_BACKGROUND_PER_MINUTE });
}

/** Один на приложение: через него идут все запросы к каталогу — поиск, артисты, лента, чарт. */
export const catalogLimiter = createCatalogLimiter();

/** Запросы к каталогу (`ITUNES_BASE`) — через ограничитель; к другим адресам (RSS чарта) — напрямую. */
function limitedFetch(fetchJson: FetchJson, limiter: RateLimiter, priority: RequestPriority): FetchJson {
  return (url) => (url.startsWith(ITUNES_BASE) ? limiter.run(priority, () => fetchJson(url)) : fetchJson(url));
}

// ---------- Загрузка списков ----------

export type FetchJson = (url: string) => Promise<unknown>;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Запрос с повтором: сервер Apple иногда отвечает 502. Нет сети — без повторов. */
async function fetchWithRetry(fetchJson: FetchJson, url: string, sleep: (ms: number) => Promise<void>): Promise<unknown> {
  let last: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchJson(url);
    } catch (err) {
      last = err;
      if (err instanceof SourceError && err.kind === 'offline') throw err;
      if (attempt < FETCH_ATTEMPTS) await sleep(FETCH_RETRY_DELAY_MS * attempt);
    }
  }
  throw last;
}

const rssSongsUrl = (country: CountryCode) => `${appleRssBase(country)}/songs.json`;
const lookupUrl = (ids: string[], country: CountryCode) => `${ITUNES_BASE}/lookup?id=${ids.join(',')}&country=${country}`;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export interface CatalogLists {
  /** «Популярное сейчас»: песни чарта страны в его порядке. */
  chart: Track[];
  /** Страна, с которой скачан чарт. */
  country?: CountryCode;
}

/** Скачивает чарт страны (по умолчанию США) и уточняет песни (длительность, альбом) через lookup. */
export async function fetchCatalog(
  deps: { fetchJson?: FetchJson; sleep?: (ms: number) => Promise<void>; limiter?: RateLimiter; country?: CountryCode } = {},
): Promise<CatalogLists> {
  // Обновление чарта — фоновое: место в окне каталога остаётся поиску пользователя.
  const fetchJson = limitedFetch(deps.fetchJson ?? ((url: string) => defaultFetchJson(url)), deps.limiter ?? catalogLimiter, 'background');
  const sleep = deps.sleep ?? defaultSleep;
  const get = (url: string) => fetchWithRetry(fetchJson, url, sleep);
  const country = deps.country ?? 'us';

  const songs = parseAppleRss(await get(rssSongsUrl(country)));
  if (songs.length === 0) throw new SourceError('unavailable', 'Чарт пока пуст — попробуй позже');

  // Длительность и альбом песен чарта; не ответил lookup — песни остаются, просто без длительности.
  const details = new Map<string, ItunesTrack>();
  for (const part of chunks(songs.map((s) => s.id), 100)) {
    try {
      for (const t of parseItunesTracks(await get(lookupUrl(part, country)))) details.set(t.trackId, t);
    } catch (err) {
      if (err instanceof SourceError && err.kind === 'offline') throw err;
    }
  }

  return { chart: buildChart(songs, details), country };
}

// ---------- Звук с YouTube ----------

export interface YtCandidate {
  id: string;
  title: string;
  channel: string;
  description: string;
  durationSec?: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Кандидаты из плоского поиска YouTube (`--flat-playlist -J ytsearchN:`), с исходным именем канала. */
export function parseYtCandidates(json: unknown): YtCandidate[] {
  if (!isObject(json) || !Array.isArray(json.entries)) return [];
  const out: YtCandidate[] = [];
  for (const e of json.entries) {
    if (!isObject(e)) continue;
    const id = str(e.id);
    const title = str(e.title);
    if (!VIDEO_ID.test(id) || !title) continue;
    if (e.ie_key !== undefined && e.ie_key !== 'Youtube') continue;
    const live = str(e.live_status);
    if (live === 'is_live' || live === 'is_upcoming' || live === 'post_live') continue;
    const c: YtCandidate = { id, title, channel: str(e.channel) || str(e.uploader), description: str(e.description) };
    if (typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration > 0) c.durationSec = Math.round(e.duration);
    out.push(c);
  }
  return out;
}

/** Не тот звук: живые записи, каверы, ускоренные/замедленные версии и т.п. (если их нет в названии самого трека). */
const BAD_MARKERS = [
  'live',
  'концерт',
  'cover',
  'кавер',
  'karaoke',
  'караоке',
  'instrumental',
  'инструментал',
  'минус',
  'remix',
  'ремикс',
  'sped up',
  'speed up',
  'ускоренная',
  'slowed',
  'замедленная',
  'reverb',
  'nightcore',
  '8d',
  'reaction',
  'реакция',
  'tutorial',
  'разбор',
  'mashup',
  'bass boosted',
  '1 hour',
  '1 час',
];
const SOFT_MARKERS = ['lyrics', 'текст', 'official video', 'music video', 'клип'];
const OFFICIAL_AUDIO = ['official audio', 'официальное аудио', 'audio'];

const hasPhrase = (text: string, phrase: string): boolean => ` ${text} `.includes(` ${phrase} `);

/** Названия без пометок в скобках: «Трек (feat. X)» → «трек». */
const coreTitle = (title: string): string => normalizeText(title.replace(/[([{].*?[)\]}]/g, ' ')) || normalizeText(title);
/** Первый исполнитель как написан: «By Индия, Xcho & МОТ» → «By Индия» (общий разбор `splitArtists`). */
const mainArtist = (artist: string): string => splitArtists(artist)[0]?.trim() || artist.trim();
/** Первый исполнитель, нормализованный. */
const firstArtist = (artist: string): string => normalizeText(mainArtist(artist));

// ---------- Транслит (запасной поиск) ----------

const CYRILLIC = /[а-яё]/i;
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Кириллица латиницей (как пишут на YouTube): «Шадэ» → «Shade», «Индия» → «Indiya». */
export function translit(s: string): string {
  return s.replace(/[а-яё]/gi, (ch) => {
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower] ?? '';
    return ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
  });
}

/** Нормализованная фраза и, если в ней кириллица, она же транслитом. */
function spellings(normalized: string): string[] {
  if (!normalized) return [];
  const t = CYRILLIC.test(normalized) ? normalizeText(translit(normalized)) : '';
  return t && t !== normalized ? [normalized, t] : [normalized];
}

/** Название трека для строгого сравнения: без пометок в скобках, как есть и транслитом. */
const titleSpellings = (title: string): string[] => spellings(coreTitle(title));
/** Все исполнители трека (не только первый), как есть и транслитом. */
const artistSpellings = (artist: string): string[] => [
  ...new Set(splitArtists(artist).flatMap((a) => spellings(normalizeText(a)))),
];

/** Перед названием в заголовке видео — начало или разделитель («Исполнитель - Название», «… | Название»). */
const TITLE_BEFORE = '-–—|:/«“"';
/** После названия — конец, скобка с пометкой или разделитель. */
const TITLE_AFTER = '-–—|:/(\\[{»”"';

/**
 * Название целиком, а не слово в чужом названии («Она танцует под Шадэ» — не «Шадэ», «Bad Times Deep House» —
 * не «BAD TIMES»): перед ним начало или разделитель, после — конец, скобка или разделитель. `nonWord` — «не буква»
 * в синтаксисе нужного движка: JS (`u`) и Python (yt-dlp).
 */
function wholeTitlePattern(variants: string[], nonWord: string): string {
  const alts = variants.map((v) =>
    v
      .split(' ')
      .filter(Boolean)
      .map((w) => w.replace(/е/g, '[её]'))
      .join(`${nonWord}+`),
  );
  return `(?:^|[${TITLE_BEFORE}])${nonWord}*(?:${alts.join('|')})${nonWord}*(?:$|[${TITLE_AFTER}])`;
}

const JS_NON_WORD = '[^\\p{L}\\p{N}]';
const wholeTitleRegex = (variants: string[]): RegExp => new RegExp(wholeTitlePattern(variants, JS_NON_WORD), 'iu');

/** Явная пометка официального аудио (без «audio» самого по себе): ей — допуск ±30 с. */
const OFFICIAL_AUDIO_STRICT = ['official audio', 'официальное аудио'];

export interface PickOptions {
  /**
   * Запасной поиск: допуск длительности ±20 с (официальному аудио — ±30 с), название должно совпасть целиком,
   * а исполнитель (любой из указанных) — быть в названии видео или в имени канала.
   */
  fallback?: boolean;
}

/**
 * Лучший кандидат YouTube для трека каталога: длительность в пределах ±10 с (если известна),
 * без признаков чужой версии; выше — официальное аудио (канал «… - Topic», «Provided to YouTube by»,
 * «Official Audio»), совпадение канала с исполнителем и названия. Ничего подходящего — null.
 * `opts.fallback` — правила запасного поиска (см. `PickOptions`).
 */
export function pickYtCandidate(
  candidates: YtCandidate[],
  target: { title: string; artist: string; durationSec?: number },
  opts: PickOptions = {},
): YtCandidate | null {
  const fallback = opts.fallback === true;
  const wantTitle = normalizeText(target.title);
  const wantCore = coreTitle(target.title);
  const wantArtist = firstArtist(target.artist);
  const wholeTitle = fallback && wantCore ? wholeTitleRegex(titleSpellings(target.title)) : null;
  const allArtists = fallback ? artistSpellings(target.artist) : [];
  let best: { c: YtCandidate; score: number } | null = null;

  candidates.forEach((c, index) => {
    const title = normalizeText(c.title);
    const channel = normalizeText(c.channel);
    const topic = /\s-\s*topic$/i.test(c.channel.trim());
    const provided = /^provided to youtube by/i.test(c.description);
    const officialAudio = OFFICIAL_AUDIO.some((m) => hasPhrase(title, m));
    const tolerance = !fallback
      ? DURATION_TOLERANCE_SEC
      : topic || provided || OFFICIAL_AUDIO_STRICT.some((m) => hasPhrase(title, m))
        ? FALLBACK_OFFICIAL_TOLERANCE_SEC
        : FALLBACK_TOLERANCE_SEC;
    let diff = 0;
    if (target.durationSec) {
      if (!c.durationSec) return;
      diff = Math.abs(c.durationSec - target.durationSec);
      if (diff > tolerance) return;
    }
    if (BAD_MARKERS.some((m) => hasPhrase(title, m) && !hasPhrase(wantTitle, m))) return;

    const titleMatch = !!wantCore && hasPhrase(title, wantCore);
    const channelBase = channel.replace(/\s*topic$/, '').trim();
    // Канал самого исполнителя (или его автоканал «… - Topic»).
    const artistChannel = !!wantArtist && !!channelBase && (hasPhrase(channelBase, wantArtist) || hasPhrase(wantArtist, channelBase));
    const artistMatch = artistChannel || (!!wantArtist && hasPhrase(title, wantArtist));
    if (fallback) {
      // Допуск мягче — сходство строже: то же название целиком и кто-то из исполнителей.
      if (!wholeTitle?.test(c.title)) return;
      if (!allArtists.some((a) => (!!channelBase && hasPhrase(channelBase, a)) || hasPhrase(title, a))) return;
    }
    // Совсем не похожее (подборки, чужие треки той же длины) — не берём. Канал исполнителя с совпавшей
    // длительностью подходит и без совпадения названия: YouTube переводит названия видео.
    else if (!titleMatch && !artistChannel && !(provided && artistMatch)) return;

    let score = 0;
    if (topic || provided) score += 4;
    else if (officialAudio) score += 2;
    if (artistMatch) score += 2;
    if (titleMatch) score += 2;
    if (SOFT_MARKERS.some((m) => hasPhrase(title, m))) score -= 1;
    score -= diff / 5;
    score -= index * 0.1;
    if (!best || score > best.score) best = { c, score };
  });

  return (best as { c: YtCandidate } | null)?.c ?? null;
}

/** Запрос поиска YouTube для трека каталога. */
export function ytSearchQuery(track: Pick<Track, 'artist' | 'title'>): string {
  return `ytsearch${YT_CANDIDATES}:${track.artist} - ${track.title}`;
}

// ---------- Фильтры кандидатов для yt-dlp (`--match-filter`) ----------

/**
 * Нормализованная фраза (`normalizeText`: только буквы, цифры и пробелы) → регулярное выражение Python для
 * yt-dlp: слова через любые не-буквы, «е» совпадает и с «ё», по границам слов. Спецсимволов в словах нет.
 */
function phraseRegex(normalized: string): string {
  return anyPhraseRegex([normalized]);
}

/** Любая из нормализованных фраз — по границам слов (как `phraseRegex`). */
function anyPhraseRegex(list: string[]): string {
  const alts = list.map((p) =>
    p
      .split(' ')
      .filter(Boolean)
      .map((w) => w.replace(/е/g, '[её]'))
      .join('\\W+'),
  );
  return alts.length === 1 ? `(?<!\\w)${alts[0]}(?!\\w)` : `(?<!\\w)(?:${alts.join('|')})(?!\\w)`;
}

/** Признаки чужой версии, которых нет в названии самого трека, — одним выражением. */
function badMarkersRegex(wantTitle: string): string | null {
  const markers = BAD_MARKERS.filter((m) => !hasPhrase(wantTitle, m)).map((m) => normalizeText(m));
  if (markers.length === 0) return null;
  return `(?i)(?<!\\w)(?:${markers.map((m) => m.split(' ').join('\\W+')).join('|')})(?!\\w)`;
}

/** Длительность трека ±`tolerance` с: условие фильтра или null, если длительность неизвестна. */
function durationCondition(durationSec?: number, tolerance = DURATION_TOLERANCE_SEC): string | null {
  if (!durationSec) return null;
  return `duration >= ${Math.max(1, durationSec - tolerance)} & duration <= ${durationSec + tolerance}`;
}

/**
 * Фильтры запасного поиска YouTube (первый запрос ничего не дал): длительность ±20 с, официальному аудио
 * (канал «… - Topic», «Provided to YouTube by», «Official Audio») — ±30 с; название целиком (не слово в чужом),
 * и кто-то из исполнителей — в названии видео или в имени канала; транслит — тоже совпадение.
 */
function fallbackFilters(target: Pick<Track, 'title' | 'artist' | 'durationSec'>): string[] {
  const titles = titleSpellings(target.title);
  const artists = artistSpellings(target.artist);
  if (titles.length === 0 || artists.length === 0) return [];
  const bad = badMarkersRegex(normalizeText(target.title));
  const badCond = bad ? `title !~= '${bad}'` : null;
  const soft = [durationCondition(target.durationSec, FALLBACK_TOLERANCE_SEC), badCond].filter((c): c is string => !!c);
  const official = [durationCondition(target.durationSec, FALLBACK_OFFICIAL_TOLERANCE_SEC), badCond].filter((c): c is string => !!c);
  const title = `title ~= '(?i)${wholeTitlePattern(titles, '\\W')}'`;
  const by = (field: string) => `${field} ~= '(?i)${anyPhraseRegex(artists)}'`;
  const all = (base: string[], ...conds: string[]) => [...base, title, ...conds].join(' & ');
  const filters = [all(soft, by('channel')), all(soft, by('title'))];
  if (!target.durationSec) return filters;
  const officialAudio = `title ~= '(?i)${anyPhraseRegex(OFFICIAL_AUDIO_STRICT)}'`;
  return [
    ...filters,
    all(official, by('channel'), `channel ~= '(?i)\\s-\\s*topic$'`),
    all(official, by('channel'), `description ~= '(?i)^provided to youtube by'`),
    all(official, by('channel'), officialAudio),
    all(official, by('title'), officialAudio),
  ];
}

/**
 * Фильтры кандидатов (`--match-filter`, несколько — «или») для поиска звука трека каталога одним запуском yt-dlp.
 * Те же правила, что у `pickYtCandidate`: длительность ±10 с, без признаков чужой версии (live, cover, sped up…),
 * и совпадение названия (YouTube) — или канал исполнителя (YouTube переводит названия видео).
 * SoundCloud строже — там полно ремиксов и перезаливов: нужны и название, и исполнитель (в названии или у автора),
 * а без длительности не ищется вовсе (не отличить отрывок). Пустой список — искать не по чему.
 * `opts.fallback` (только YouTube) — фильтры запасного поиска: мягче длительность, строже название.
 */
export function matchFilters(
  target: Pick<Track, 'title' | 'artist' | 'durationSec'>,
  site: 'youtube' | 'soundcloud',
  opts: PickOptions = {},
): string[] {
  if (opts.fallback && site === 'youtube') return fallbackFilters(target);
  const core = coreTitle(target.title);
  const artist = firstArtist(target.artist);
  const duration = durationCondition(target.durationSec);
  if (!core || (site === 'soundcloud' && (!duration || !artist))) return [];
  const bad = badMarkersRegex(normalizeText(target.title));
  const base = [duration, bad ? `title !~= '${bad}'` : null].filter((c): c is string => !!c);
  const title = `title ~= '(?i)${phraseRegex(core)}'`;
  const by = (field: string) => `${field} ~= '(?i)${phraseRegex(artist)}'`;
  const all = (...conds: string[]) => [...base, ...conds].join(' & ');
  if (site === 'youtube') return artist ? [all(title), all(by('channel'))] : [all(title)];
  return [all(title, by('title')), all(title, by('uploader'))];
}

/** Первый запрос поиска YouTube: «исполнитель - название» — так находится почти всё. */
const primaryQuery = (track: Pick<Track, 'artist' | 'title'>): string => `${track.artist} - ${track.title}`;

/**
 * Запасные запросы YouTube — одним запуском, по очереди, до первого подходящего: основной исполнитель + название
 * («topic» поднимает официальное аудио), все исполнители + название + «audio», транслит (если есть кириллица).
 */
export function fallbackQueries(track: Pick<Track, 'artist' | 'title'>): string[] {
  const title = track.title.trim();
  const main = mainArtist(track.artist);
  const queries = [`${main} - ${title} topic`, `${track.artist.trim()} ${title} audio`];
  if (CYRILLIC.test(`${track.artist}${track.title}`)) queries.push(`${translit(main)} - ${translit(title)}`);
  return [...new Set(queries)].filter((q) => q !== primaryQuery(track));
}

/** Запрос поиска SoundCloud: исполнитель и название без пометок в скобках. */
function scQuery(track: Pick<Track, 'artist' | 'title'>): string {
  return `${track.artist} ${track.title.replace(/[([{].*?[)\]}]/g, ' ')}`.replace(/\s+/g, ' ').trim();
}

// ---------- Сопоставления «трек каталога → звук» ----------

/** Где нашёлся звук трека каталога. */
export type MatchSource = 'youtube' | 'soundcloud';

interface MatchEntry {
  source: MatchSource;
  /** id видео YouTube или трека SoundCloud. */
  id: string;
  at: number;
}

const SC_ID = /^\d{1,20}$/;

/** `catalog-matches.json`: `{source, id, at}`; записи прежних версий `{videoId, at}` — YouTube. */
function normalizeMatches(raw: unknown): Map<string, MatchEntry> {
  const map = new Map<string, MatchEntry>();
  const list = isObject(raw) && isObject(raw.matches) ? raw.matches : {};
  for (const [trackId, v] of Object.entries(list)) {
    if (!isObject(v) || typeof v.at !== 'number') continue;
    if (v.source === 'soundcloud' && SC_ID.test(str(v.id))) map.set(trackId, { source: 'soundcloud', id: str(v.id), at: v.at });
    else if (VIDEO_ID.test(str(v.id)) && (v.source === undefined || v.source === 'youtube')) map.set(trackId, { source: 'youtube', id: str(v.id), at: v.at });
    else if (VIDEO_ID.test(str(v.videoId))) map.set(trackId, { source: 'youtube', id: str(v.videoId), at: v.at });
  }
  return map;
}

/** Запись для файла: у YouTube и прежнее поле `videoId` — его читают и старые версии. */
type StoredMatch = { source: MatchSource; id: string; at: number; videoId?: string };
const toStored = (m: MatchEntry): StoredMatch => (m.source === 'youtube' ? { ...m, videoId: m.id } : { ...m });

export interface CatalogAdapterDeps {
  fetchJson?: FetchJson;
  run?: RunYtDlp;
  youtube?: SourceAdapter;
  soundcloud?: SourceAdapter;
  readMatches?: () => Promise<unknown>;
  writeMatches?: (data: { version: 1; matches: Record<string, StoredMatch> }) => Promise<void>;
  now?: () => number;
  /** Ограничитель частоты запросов к каталогу (по умолчанию общий `catalogLimiter`). */
  limiter?: RateLimiter;
  /** Сколько ждать SoundCloud, прежде чем играть с YouTube (по умолчанию `SC_LIMIT_MS`). */
  scLimitMs?: number;
  /** Проверка ссылки для `opts.verify` (по умолчанию запрос первых байт). */
  probe?: ProbeStream;
}

/** SoundCloud ищется первым, но старт не задерживает дольше этого: не ответил — играет YouTube. */
export const SC_LIMIT_MS = 4_000;
/** Нет сети или 403 (без VPN из России, частые запросы) — столько времени SoundCloud не ждём вовсе. */
const SC_DOWN_MS = 5 * 60_000;

/** Трек источника, на котором играет трек каталога: метаданные (название, обложка) остаются от каталога. */
function asSourceTrack(track: Track, match: MatchEntry): Track {
  if (match.source === 'soundcloud') {
    return { ...track, id: makeTrackId('soundcloud', match.id), source: 'soundcloud', sourceId: match.id, pageUrl: undefined };
  }
  return { ...track, id: makeTrackId('youtube', match.id), source: 'youtube', sourceId: match.id, pageUrl: watchUrl(match.id) };
}

const abortError = () => new DOMException('Aborted', 'AbortError');
const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === 'AbortError';

interface SharedJob<T> {
  promise: Promise<T>;
  controller: AbortController;
  refs: number;
}

/**
 * Одна работа на ключ для всех, кто её ждёт: каждый ждущий может отказаться своим `signal`,
 * а сама работа (yt-dlp) отменяется, только когда отказались все.
 */
function joinShared<T>(jobs: Map<string, SharedJob<T>>, key: string, start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  let job = jobs.get(key);
  if (!job) {
    const controller = new AbortController();
    const created: SharedJob<T> = { controller, refs: 0, promise: Promise.resolve() as Promise<never> };
    created.promise = start(controller.signal).finally(() => {
      if (jobs.get(key) === created) jobs.delete(key);
    });
    // Отказ от отменённой работы не должен стать «необработанной ошибкой».
    created.promise.catch(() => undefined);
    jobs.set(key, created);
    job = created;
  }
  const j = job;
  j.refs++;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const leave = () => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      j.refs--;
    };
    const onAbort = () => {
      if (done) return;
      leave();
      if (j.refs === 0) {
        if (jobs.get(key) === j) jobs.delete(key);
        j.controller.abort();
      }
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    j.promise.then(
      (v) => {
        if (done) return;
        leave();
        resolve(v);
      },
      (err: unknown) => {
        if (done) return;
        leave();
        reject(err);
      },
    );
  });
}

/** Промис, который с этим сигналом отклоняется AbortError (а не висит). */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** Найденный звук: где он и, если поиск уже дал её, ссылка на поток. */
interface Found {
  match: MatchEntry;
  /** Ссылка из поиска (один запуск); null — звук возьмёт адаптер источника. */
  url: string | null;
  until: number;
  /** Сопоставление взято из сохранённых, а не найдено сейчас. */
  cached: boolean;
}

/** Ошибки, после которых найденный звук больше не годится (а не «сеть медленная»). */
const DEAD_SOUND = /Видео недоступно|возрастным ограничением|нет звука|Трек недоступен на SoundCloud|30-секундный отрывок|защищён правообладателем/;

export function createCatalogAdapter(deps: CatalogAdapterDeps = {}): SourceAdapter {
  // Поиск треков — действие пользователя.
  const fetchJson = limitedFetch(deps.fetchJson ?? ((url: string) => defaultFetchJson(url)), deps.limiter ?? catalogLimiter, 'user');
  const run = deps.run ?? runYtDlp;
  const youtube = deps.youtube ?? youtubeAdapter;
  const soundcloud = deps.soundcloud ?? soundcloudAdapter;
  const readMatches = deps.readMatches ?? (() => readJson<unknown>(MATCHES_FILE, null));
  const writeMatches = deps.writeMatches ?? ((data) => writeJson(MATCHES_FILE, data));
  const now = deps.now ?? Date.now;
  const scLimitMs = deps.scLimitMs ?? SC_LIMIT_MS;
  const probe = deps.probe ?? probeStream;

  let matches: Promise<Map<string, MatchEntry>> | null = null;
  const misses = new Map<string, number>();
  const searches = new Map<string, SharedJob<Found>>();
  /** До этого времени SoundCloud считается недоступным (нет сети или 403): звук ищется сразу на YouTube. */
  let scDownUntil = 0;
  /** Ссылки, которые дал поиск одним запуском: первый старт трека — без второго запуска yt-dlp. */
  const streams = new Map<string, { url: string; until: number }>();

  const loadMatches = () => (matches ??= readMatches().then(normalizeMatches, () => new Map<string, MatchEntry>()));
  async function persist(): Promise<void> {
    const map = await loadMatches();
    while (map.size > MATCHES_LIMIT) map.delete(map.keys().next().value!);
    const out: Record<string, StoredMatch> = {};
    for (const [k, v] of map) out[k] = toStored(v);
    await writeMatches({ version: 1, matches: out }).catch(() => undefined);
  }

  const enabled = (ctx: SourceContext, source: MatchSource): boolean =>
    source === 'youtube' ? ctx.settings.youtubeEnabled : ctx.settings.soundcloudEnabled;

  function ensureSomeSource(ctx: SourceContext): void {
    if (!ctx.settings.youtubeEnabled && !ctx.settings.soundcloudEnabled) throw new SourceError('disabled', CATALOG_NEEDS_YOUTUBE_MESSAGE);
  }

  async function remember(track: Track, match: MatchEntry): Promise<void> {
    const map = await loadMatches();
    map.delete(track.id);
    map.set(track.id, match);
    await persist();
  }

  /** Один шаг поиска YouTube: запросы и ссылка одним запуском; найденное проверяется теми же правилами. */
  async function searchYoutubeStep(track: Track, queries: string[], opts: PickOptions, signal: AbortSignal): Promise<Found | null> {
    const filters = matchFilters(track, 'youtube', opts);
    if (filters.length === 0 || queries.length === 0) return null;
    const hit = await searchYtStream(run, queries, filters, { signal, timeoutMs: YT_SEARCH_TIMEOUT_MS, now });
    if (!hit) return null;
    // Без ссылки (быстрый клиент не дал звука) метаданных нет — кандидата уже отобрали фильтры.
    const candidate = { id: hit.videoId, title: hit.title, channel: hit.channel, description: hit.description, durationSec: hit.durationSec };
    if (hit.url && !pickYtCandidate([candidate], track, opts)) return null;
    return { match: { source: 'youtube', id: hit.videoId, at: now() }, url: hit.url, until: hit.until, cached: false };
  }

  /**
   * YouTube ступенчато: сначала «исполнитель - название», как всегда (обычный трек — одним запуском);
   * ничего не подошло — запасные запросы с мягче допуском длительности и строже сходством названия.
   */
  async function searchYoutube(track: Track, signal: AbortSignal): Promise<Found | null> {
    const first = await searchYoutubeStep(track, [primaryQuery(track)], {}, signal);
    if (first) return first;
    if (signal.aborted) throw abortError();
    return searchYoutubeStep(track, fallbackQueries(track), { fallback: true }, signal);
  }

  /**
   * SoundCloud: полная версия той же длительности; не ответил за `scLimitMs` — null (процесс убивается).
   * Нет сети или 403 — null, и следующие треки SC_DOWN_MS его не ждут; просто не успел или иной сбой — нет.
   */
  async function searchSoundcloud(track: Track, signal: AbortSignal): Promise<Found | null> {
    const filters = matchFilters(track, 'soundcloud');
    if (filters.length === 0 || now() < scDownUntil) return null;
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), scLimitMs);
    try {
      const hit = await searchScStream(run, scQuery(track), filters, { signal: AbortSignal.any([signal, limit.signal]), now });
      return hit ? { match: { source: 'soundcloud', id: hit.track.sourceId, at: now() }, url: hit.url, until: hit.until, cached: false } : null;
    } catch (err) {
      if (signal.aborted) throw err;
      // Не успел за короткий предел — обычная задержка: играет YouTube, следующий трек снова спросит SoundCloud.
      if (!limit.signal.aborted && isScUnreachable(err)) scDownUntil = now() + SC_DOWN_MS;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Поиск звука: SoundCloud первым (полная версия, ±10 с), одновременно — YouTube. SoundCloud нашёл за короткий
   * предел — играет он, YouTube отменяется; нет — YouTube. Найденное запоминается с пометкой источника.
   */
  async function searchSound(track: Track, ctx: SourceContext, signal: AbortSignal, fresh: boolean): Promise<Found> {
    // Недавний отказ — не ищем снова; «Повторить» (`fresh`) ищет всегда.
    const missUntil = misses.get(track.id);
    if (!fresh && missUntil && missUntil > now()) throw new SourceError('unavailable', CATALOG_NOT_FOUND_MESSAGE);
    misses.delete(track.id);
    const yt = new AbortController();
    const stopYt = () => yt.abort();
    signal.addEventListener('abort', stopYt, { once: true });
    const ytSearch = ctx.settings.youtubeEnabled ? searchYoutube(track, yt.signal) : null;
    ytSearch?.catch(() => undefined);
    try {
      const sc = ctx.settings.soundcloudEnabled ? await searchSoundcloud(track, signal) : null;
      if (sc) {
        yt.abort();
        await remember(track, sc.match);
        return sc;
      }
      if (!ytSearch) {
        if (signal.aborted) throw abortError();
        // SoundCloud не нашёл, а YouTube выключен: подсказка, где включить.
        throw new SourceError('disabled', CATALOG_NEEDS_YOUTUBE_MESSAGE);
      }
      let found: Found | null;
      try {
        found = await ytSearch;
      } catch (err) {
        if (isAbort(err)) throw err;
        throw classifyYtDlpError(err);
      }
      if (!found) {
        misses.set(track.id, now() + MISS_TTL_MS);
        throw new SourceError('unavailable', CATALOG_NOT_FOUND_MESSAGE);
      }
      await remember(track, found.match);
      return found;
    } finally {
      signal.removeEventListener('abort', stopYt);
    }
  }

  /** Звук трека: сохранённое сопоставление (источник включён) или поиск — один на всех ждущих; `fresh` — без памяти отказа. */
  async function soundFor(track: Track, ctx: SourceContext, signal?: AbortSignal, fresh = false): Promise<Found> {
    if (track.source !== 'catalog' || !track.title.trim()) throw new SourceError('unavailable', 'Неверный трек каталога');
    const known = (await loadMatches()).get(track.id);
    if (known && enabled(ctx, known.source)) return { match: known, url: null, until: 0, cached: true };
    return joinShared(searches, track.id, (s) => searchSound(track, ctx, s, fresh), signal);
  }

  /** Сохранённый звук больше не играет (удалили, закрыли) — забываем, следующий запуск найдёт заново. */
  async function forget(track: Track): Promise<void> {
    streams.delete(track.id);
    const map = await loadMatches();
    if (map.delete(track.id)) await persist();
  }

  const adapterOf = (source: MatchSource): SourceAdapter => (source === 'soundcloud' ? soundcloud : youtube);

  return {
    id: 'catalog',

    async search(query, ctx) {
      const country = resolveCountry(ctx.settings?.chartCountry);
      const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&media=music&entity=song&country=${country}&limit=${SEARCH_LIMIT}`;
      return parseItunesTracks(await fetchWithRetry(fetchJson, url, defaultSleep)).map(itunesTrackToTrack);
    },

    async resolveStream(track, ctx, opts) {
      ensureSomeSource(ctx);
      const signal = opts?.signal;
      // Проверка звука (волна): ссылка поиска должна правда отдавать звук, иначе — через адаптер источника.
      const usable = async (url: string) => !opts?.verify || (await probe(url, signal));
      const ready = streams.get(track.id);
      if (ready && ready.until > now() && !opts?.fresh && (await usable(ready.url))) return ready.url;
      const found = await soundFor(track, ctx, signal, !!opts?.fresh);
      if (found.url && found.until > now() && !opts?.fresh && (await usable(found.url))) {
        streams.set(track.id, { url: found.url, until: found.until });
        while (streams.size > MATCHES_LIMIT) streams.delete(streams.keys().next().value!);
        return found.url;
      }
      streams.delete(track.id);
      try {
        const work = adapterOf(found.match.source).resolveStream(asSourceTrack(track, found.match), ctx, opts);
        return await (signal ? abortable(work, signal) : work);
      } catch (err) {
        if (found.cached && err instanceof SourceError && DEAD_SOUND.test(err.message)) await forget(track);
        throw err;
      }
    },

    async download(track, destPath, ctx, onProgress, signal) {
      ensureSomeSource(ctx);
      const found = await soundFor(track, ctx, signal);
      // Скачивание — из того же источника, откуда трек играет.
      const adapter = adapterOf(found.match.source);
      if (!adapter.download) throw new SourceError('unavailable', 'Скачивание этого трека недоступно');
      try {
        return await adapter.download(asSourceTrack(track, found.match), destPath, ctx, onProgress, signal);
      } catch (err) {
        if (found.cached && err instanceof SourceError && DEAD_SOUND.test(err.message)) await forget(track);
        throw err;
      }
    },
  };
}

export const catalog = createCatalogAdapter();
