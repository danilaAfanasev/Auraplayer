// Тексты песен: чистая логика — разбор синхронного текста (LRC), запрос к базе текстов из трека,
// выбор подходящей записи и «строка по времени». Без electron и DOM; сеть и кэш — в `src/main/lyrics.ts`.
import { artistKey, splitArtists } from './artistNames';
import type { Track } from './types';

/** Строка синхронного текста: с какой секунды звучит. Пустой `text` — пауза между строками. */
export interface LyricLine {
  timeSec: number;
  text: string;
}

/** Текст трека. `none` — текста нет (не нашёлся, инструментал). */
export type Lyrics =
  | { kind: 'synced'; lines: LyricLine[]; plain?: string }
  | { kind: 'plain'; text: string }
  | { kind: 'none' };

/** Что спрашиваем у базы: основной исполнитель, название без пометок, альбом и длительность трека. */
export interface LyricsQuery {
  artist: string;
  title: string;
  album?: string;
  durationSec?: number;
}

/** Запись базы текстов (поля ответа, которые нам нужны). */
export interface LyricsRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/** Точное совпадение по длительности и допуск при поиске — секунды (истории 159). */
export const EXACT_DURATION_SEC = 3;
export const SEARCH_DURATION_SEC = 5;

// ---------- Очистка запроса ----------

const BRACKETS = /[([{【][^)\]}】]*[)\]}】]/gu;
const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';
/** Пометки, которые не часть названия песни: тип ролика, ускорение/замедление, ремастер. */
const NOISE = new RegExp(
  `${WORD_START}(?:official|video|audio|lyrics?|visualizer|hd|hq|4k|clip|speed(?:ed)?[ -]?up|sped[ -]?up|slowed|reverb|nightcore|remaster(?:ed)?|bass boosted|премьера|клип|текст|официальн\\p{L}*)${WORD_END}`,
  'iu',
);
/** «Song ft. X» без скобок — до тире/вертикальной черты или конца строки. */
const PLAIN_FEAT = /\s+(?:feat\.?|ft\.?|featuring|при\s+уч\.?|при\s+участии)\s+.+?(?=\s+[-–—|]\s+|$)/iu;
/** «Song speed up», «Song slowed + reverb» в конце названия — без тире и скобок. */
const TRAILING_EFFECT = /\s+(?:speed(?:ed)?[ -]?up|sped[ -]?up|slowed(?:\s*\+?\s*reverb)?|nightcore|reverb)\s*$/iu;
const SEGMENT_SPLIT = /\s+[-–—|]\s+/u;

/**
 * Название без пометок: «Song (feat. X) [Official Video]», «Song - Slowed + Reverb», «Artist - Song | Official Audio» → «Song».
 * `artists` — имена исполнителей: «Artist - » в начале названия срезается. Осталась пустота — исходное название.
 */
export function cleanLyricsTitle(title: string, artists: string[] = []): string {
  let t = title.replace(BRACKETS, ' ').replace(PLAIN_FEAT, '').replace(/\s+/g, ' ').trim();
  const parts = t.split(SEGMENT_SPLIT);
  if (parts.length > 1) {
    const keys = new Set(artists.map(artistKey).filter(Boolean));
    const kept = parts.filter((part, i) => {
      if (i === 0) return true;
      return !NOISE.test(part) && !/^\d{4}$/.test(part.trim());
    });
    if (kept.length > 1 && keys.has(artistKey(kept[0]))) kept.shift();
    t = kept.join(' - ');
  }
  t = t.replace(TRAILING_EFFECT, '').replace(/\s+/g, ' ').trim();
  return t || title.trim();
}

const trackArtists = (track: Pick<Track, 'artist' | 'title'>): string[] => splitArtists(track.artist, track.title);

/** Запрос к базе: основной исполнитель, чистое название, альбом, длительность (целые секунды). */
export function lyricsQuery(track: Track): LyricsQuery {
  const artists = trackArtists(track);
  const q: LyricsQuery = {
    artist: artists[0]?.trim() || track.artist.trim(),
    title: cleanLyricsTitle(track.title, [track.artist, ...artists]),
  };
  const album = track.album?.trim();
  if (album) q.album = album;
  if (typeof track.durationSec === 'number' && Number.isFinite(track.durationSec) && track.durationSec > 0) {
    q.durationSec = Math.round(track.durationSec);
  }
  return q;
}

/** Шаг ключа по длительности: версии заметно разной длины (ускоренная, удлинённая) — не одна песня. */
const DURATION_BUCKET_SEC = 5;

/** Ключ кэша: основной исполнитель, название без пометок и длительность «пачкой» — одна песня из разных источников даёт один ключ. */
export function lyricsKey(track: Track): string {
  const q = lyricsQuery(track);
  const bucket = q.durationSec === undefined ? 'x' : String(Math.round(q.durationSec / DURATION_BUCKET_SEC));
  return `${artistKey(q.artist)}|${artistKey(q.title)}|${bucket}`;
}

// ---------- Синхронный текст (LRC) ----------

const LRC_LINE = /^((?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/u;
const LRC_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu;
/** Пословные метки расширенного LRC: `<00:01.50>`. */
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/gu;

/**
 * Разбор LRC: `[mm:ss.xx]` (сотые, тысячные или без долей), несколько меток на строке — столько же строк,
 * итог упорядочен по времени. Строка с меткой и пустым текстом — пауза, остаётся. Метки `[ar:…]` и строки без метки — мимо.
 */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = LRC_LINE.exec(raw);
    if (!m) continue;
    const text = m[2].replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    for (const tag of m[1].matchAll(LRC_TAG)) {
      const frac = tag[3] ? Number(`0.${tag[3]}`) : 0;
      const timeSec = Math.round((Number(tag[1]) * 60 + Number(tag[2]) + frac) * 1000) / 1000;
      out.push({ timeSec, text });
    }
  }
  return out.sort((a, b) => a.timeSec - b.timeSec);
}

// ---------- Записи базы ----------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Запись из ответа базы; ответ-ошибка и мусор → `null`. */
export function parseLyricsRecord(raw: unknown): LyricsRecord | null {
  if (!isObject(raw)) return null;
  if (typeof raw.trackName !== 'string' || typeof raw.artistName !== 'string') return null;
  const rec: LyricsRecord = {
    id: typeof raw.id === 'number' && Number.isFinite(raw.id) ? raw.id : 0,
    trackName: raw.trackName,
    artistName: raw.artistName,
    instrumental: raw.instrumental === true,
    plainLyrics: textOrNull(raw.plainLyrics),
    syncedLyrics: textOrNull(raw.syncedLyrics),
  };
  if (typeof raw.albumName === 'string' && raw.albumName.trim()) rec.albumName = raw.albumName;
  if (typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration > 0) rec.duration = raw.duration;
  return rec;
}

/** Список записей из ответа поиска; не массив → пусто, мусорные элементы отбрасываются. */
export function parseLyricsRecords(raw: unknown): LyricsRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseLyricsRecord).filter((r): r is LyricsRecord => r !== null);
}

/** 2 — синхронный текст, 1 — простой, 0 — ни того ни другого (инструментал, пустая запись). */
function lyricsClass(r: LyricsRecord): 0 | 1 | 2 {
  if (r.instrumental) return 0;
  if (parseLrc(r.syncedLyrics ?? '').some((l) => l.text !== '')) return 2;
  return r.plainLyrics ? 1 : 0;
}

/** Меньше стольких непустых строк — не текст песни, а мусорная запись («probe»); такая проигрывает любой настоящей. */
export const MIN_LYRICS_LINES = 3;

/** Непустых строк в записи — больше из синхронного и простого текста. */
function lyricsLineCount(r: LyricsRecord): number {
  if (r.instrumental) return 0;
  const synced = parseLrc(r.syncedLyrics ?? '').filter((l) => l.text !== '').length;
  const plain = (r.plainLyrics ?? '').split(/\r?\n/).filter((l) => l.trim() !== '').length;
  return Math.max(synced, plain);
}

const sameText = (a: string, b: string): boolean => artistKey(a) === artistKey(b);

/**
 * Лучшая запись из ответа базы для запроса или `null`. Подходит та, у которой исполнитель (любой из соавторов)
 * и название без пометок совпадают, а длительность — в пределах `toleranceSec` (по умолчанию ±5 с; нет длительности
 * у трека или записи — не отсекает). Порядок: запись с текстом в `MIN_LYRICS_LINES`+ строк лучше короче (мусорной
 * или инструментала); длительность ±3 с лучше ±5; синхронный лучше простого, простой лучше инструментала;
 * ближе по длительности; тот же альбом.
 */
export function pickLyricsRecord(records: LyricsRecord[], q: LyricsQuery, toleranceSec: number = SEARCH_DURATION_SEC): LyricsRecord | null {
  const wantArtist = artistKey(q.artist);
  const wantTitle = artistKey(q.title);
  const scored: { rec: LyricsRecord; full: number; tier: number; cls: number; diff: number; album: number }[] = [];
  for (const rec of records) {
    const names = [rec.artistName, ...splitArtists(rec.artistName)].map(artistKey);
    if (!names.includes(wantArtist)) continue;
    if (artistKey(cleanLyricsTitle(rec.trackName, [rec.artistName])) !== wantTitle) continue;
    let tier = 1;
    let diff = 0;
    if (q.durationSec !== undefined && rec.duration !== undefined) {
      diff = Math.abs(rec.duration - q.durationSec);
      if (diff > toleranceSec) continue;
      tier = diff <= EXACT_DURATION_SEC ? 0 : 1;
    } else if (q.durationSec === undefined) {
      tier = 0;
    }
    const album = q.album && rec.albumName && sameText(q.album, rec.albumName) ? 1 : 0;
    const full = lyricsLineCount(rec) >= MIN_LYRICS_LINES ? 1 : 0;
    scored.push({ rec, full, tier, cls: lyricsClass(rec), diff, album });
  }
  scored.sort((a, b) => b.full - a.full || a.tier - b.tier || b.cls - a.cls || a.diff - b.diff || b.album - a.album);
  return scored[0]?.rec ?? null;
}

/** Текст из записи: синхронный (если в нём есть слова), иначе простой, иначе «нет». Инструментал — «нет». */
export function lyricsFromRecord(rec: LyricsRecord | null): Lyrics {
  if (!rec || rec.instrumental) return { kind: 'none' };
  const lines = parseLrc(rec.syncedLyrics ?? '');
  const plain = rec.plainLyrics?.trim() ? rec.plainLyrics.replace(/\r\n/g, '\n').trim() : undefined;
  if (lines.some((l) => l.text !== '')) return plain ? { kind: 'synced', lines, plain } : { kind: 'synced', lines };
  if (plain) return { kind: 'plain', text: plain };
  return { kind: 'none' };
}

/** Индекс строки, которая звучит в `sec`: последняя, чьё время уже наступило. До первой строки — -1. */
export function lineIndexAt(lines: LyricLine[], sec: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeSec <= sec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
