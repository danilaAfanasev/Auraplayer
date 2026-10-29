// Волна: чистая логика отбора треков — без дублей, без «не понравившихся» исполнителей; в любых 10 подряд —
// 10 разных исполнителей (с фитами), песни из «Мне нравится» — не больше одной на 10, другая письменность (зарубежное
// для русской волны и наоборот) — не меньше ~20 %, когда кандидаты её дали. Общая для main и renderer.
import { artistKey, splitArtists } from './artistNames';
import type { Track } from './types';

/** В любых стольких треках волны подряд — разные исполнители (все исполнители трека, с фитами). */
export const WAVE_ARTIST_WINDOW = 10;
/** Ослабленное окно: только когда кандидатов на полное не хватает (повтор не ближе 5 треков, подряд — никогда). */
export const WAVE_MIN_ARTIST_GAP = 5;
/** Песен из «Мне нравится» — не больше стольких на окно. */
export const WAVE_LIKED_PER_WINDOW = 1;
/** Доля треков другой письменности, когда кандидаты её дали. */
export const WAVE_FOREIGN_SHARE = 0.2;
/** Доля письменности считается по стольким последним трекам волны. */
const SCRIPT_SPAN = 30;

/** Письменность трека (исполнитель + название): эвристика только для доли «зарубежного», не для отсева. */
export type WaveScript = 'cyrillic' | 'latin' | 'other';

/** Что волна уже знает о себе. Только массивы строк — можно хранить и передавать как есть. */
export interface WaveMemory {
  /** id всех треков, уже поставленных в волну. */
  ids: string[];
  /** `songKey` всех треков волны: одна песня из разных источников — один ключ. */
  songs: string[];
  /** «Не нравится»: треки… */
  bannedIds: string[];
  /** …и их исполнители (`artistKeys`). */
  bannedArtists: string[];
  /** Исполнители последних `WAVE_ARTIST_WINDOW - 1` треков очереди (`artistsKey`), последний — в конце. */
  tail: string[];
  /** `songKey` тех же треков, что `tail` (по порядку): квота лайкнутых. */
  tailSongs: string[];
  /** Письменность последних треков волны (`WaveScript`), последний — в конце: доля другой письменности. */
  scripts: string[];
}

export function emptyWaveMemory(): WaveMemory {
  return { ids: [], songs: [], bannedIds: [], bannedArtists: [], tail: [], tailSongs: [], scripts: [] };
}

export interface WavePickOptions {
  /** `songKey` песен из «Мне нравится»: таких — не больше `WAVE_LIKED_PER_WINDOW` на окно. */
  liked?: ReadonlySet<string>;
  /** Окно исполнителей (и лайков): по умолчанию `WAVE_ARTIST_WINDOW`; `WAVE_MIN_ARTIST_GAP` — когда кандидатов мало. */
  gap?: number;
}

/** Регистр, ё, знаки препинания и символы ($, «») не важны. */
const normalize = artistKey;

/** Исполнители трека как написаны: «VILLIAN & madk1d» → ['VILLIAN', 'madk1d']; с названием — и фиты из него. */
export function artistNames(artist: string, title?: string): string[] {
  return splitArtists(artist, title);
}

/** Все исполнители трека, нормализованные: «VILLIAN & madk1d» → ['villian', 'madk1d']; с названием — и фиты из него. */
export function artistKeys(artist: string, title?: string): string[] {
  const out: string[] = [];
  for (const part of splitArtists(artist, title)) {
    const key = artistKey(part);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Исполнители трека вместе с фитами из названия. */
function trackArtistKeys(track: Pick<Track, 'artist'> & { title?: string }): string[] {
  return artistKeys(track.artist, track.title);
}

/** Основной (первый) исполнитель трека. */
export function primaryArtist(track: Pick<Track, 'artist'>): string {
  return artistKeys(track.artist)[0] ?? '';
}

/** Разделитель в `artistsKey`: в нормализованных именах его не бывает. */
const KEY_SEP = '|';

/** Все исполнители трека (и фиты из названия) одной строкой — запись «хвоста» волны. */
export function artistsKey(track: Pick<Track, 'artist'> & { title?: string }): string {
  return trackArtistKeys(track).join(KEY_SEP);
}

/** Название без пометок в скобках («(Official Audio)», «(feat. X)», «[prod. Y]»). */
function coreTitle(title: string): string {
  return normalize(title.replace(/[([{【].*?[)\]}】]/g, ' ')) || normalize(title);
}

/** Ключ песни: «основной исполнитель — название без пометок». */
export function songKey(track: Pick<Track, 'artist' | 'title'>): string {
  return `${primaryArtist(track)} — ${coreTitle(track.title)}`;
}

/**
 * Письменность трека: есть кириллица в исполнителе или названии — кириллица (русские исполнители с латинским именем
 * пишут названия по-русски); иначе — каких букв больше, латиницы или прочих (японская, корейская…).
 */
export function scriptOf(track: Pick<Track, 'artist' | 'title'>): WaveScript {
  const text = `${track.artist} ${track.title}`;
  if (/\p{Script=Cyrillic}/u.test(text)) return 'cyrillic';
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const other = text.match(/\p{L}/gu)?.length ?? 0;
  return other - latin > latin ? 'other' : 'latin';
}

/** Трек или любой его исполнитель (и на фите в названии) отмечены «Не нравится» в этой волне. */
export function isBanned(track: Track, memory: WaveMemory): boolean {
  if (memory.bannedIds.includes(track.id)) return true;
  return trackArtistKeys(track).some((a) => memory.bannedArtists.includes(a));
}

/** «Не нравится»: трек и все его исполнители (и фиты из названия) больше не попадают в эту волну. */
export function banTrack(memory: WaveMemory, track: Track): WaveMemory {
  const artists = trackArtistKeys(track).filter((a) => !memory.bannedArtists.includes(a));
  return {
    ...memory,
    bannedIds: memory.bannedIds.includes(track.id) ? memory.bannedIds : [...memory.bannedIds, track.id],
    bannedArtists: [...memory.bannedArtists, ...artists],
  };
}

/** Длина хвоста: окно без самого нового трека. */
const TAIL = WAVE_ARTIST_WINDOW - 1;

/** Хвост волны — по этим трекам (последние — в конце): очередь от начала до конца плюс отобранные, но ещё не вставшие. */
export function syncWaveTail(memory: WaveMemory, tracks: readonly Track[]): WaveMemory {
  const last = tracks.slice(-TAIL);
  return { ...memory, tail: last.map(artistsKey), tailSongs: last.map(songKey) };
}

/** Может ли трек (его исполнители и лайк) встать после хвоста при окне `gap`. */
function fitsTail(artists: string, song: string, tail: readonly string[], tailSongs: readonly string[], opts: WavePickOptions): boolean {
  const gap = Math.max(2, opts.gap ?? WAVE_ARTIST_WINDOW);
  const recent = tail.slice(-(gap - 1)).flatMap((k) => k.split(KEY_SEP));
  if (artists && artists.split(KEY_SEP).some((a) => recent.includes(a))) return false;
  const liked = opts.liked;
  if (liked && liked.has(song)) {
    const likedInWindow = tailSongs.slice(-(gap - 1)).filter((s) => liked.has(s)).length;
    if (likedInWindow >= WAVE_LIKED_PER_WINDOW) return false;
  }
  return true;
}

/** Можно ли поставить трек сразу после этих треков (очередь волны): окно исполнителей и квота лайков. */
export function canFollow(track: Track, before: readonly Track[], opts: WavePickOptions = {}): boolean {
  const last = before.slice(-TAIL);
  return fitsTail(artistsKey(track), songKey(track), last.map(artistsKey), last.map(songKey), opts);
}

/** Самая частая письменность (при равенстве — встретившаяся раньше). */
function homeScript(scripts: readonly string[]): string | null {
  const count = new Map<string, number>();
  let best: string | null = null;
  for (const s of scripts) {
    const c = (count.get(s) ?? 0) + 1;
    count.set(s, c);
    if (best === null || c > (count.get(best) ?? 0)) best = s;
  }
  return best;
}

/**
 * Следующая порция волны из кандидатов (в их порядке): без уже бывших в волне (по id и по песне), без «не понравившихся»;
 * исполнитель трека (и на фитах) не встречается в последних `gap - 1` треках хвоста, песня из «Мне нравится» — не чаще
 * одной на окно. Трек, нарушающий окно, ждёт; разбавить нечем — не берётся (порция короче, а то и пустая: тогда
 * волна догружает кандидатов и, если не хватает и их, зовёт отбор с окном `WAVE_MIN_ARTIST_GAP`).
 * Если среди кандидатов есть треки другой письменности, чем у большинства волны, — они идут вперёд очереди, пока
 * их меньше `WAVE_FOREIGN_SHARE` (≈ каждый пятый). Возвращает и обновлённую память.
 */
export function pickWaveTracks(
  candidates: readonly Track[],
  memory: WaveMemory,
  limit = Infinity,
  opts: WavePickOptions = {},
): { picked: Track[]; memory: WaveMemory } {
  const ids = new Set(memory.ids);
  const songs = new Set(memory.songs);
  const pool: { track: Track; song: string; artist: string; script: WaveScript }[] = [];
  for (const track of candidates) {
    const song = songKey(track);
    if (ids.has(track.id) || songs.has(song) || isBanned(track, memory)) continue;
    if (pool.some((p) => p.track.id === track.id || p.song === song)) continue;
    pool.push({ track, song, artist: artistsKey(track), script: scriptOf(track) });
  }

  const tail = memory.tail.slice();
  const tailSongs = memory.tailSongs.slice();
  const scripts = memory.scripts.slice();
  const home = homeScript(scripts) ?? homeScript(pool.map((p) => p.script));
  const picked: Track[] = [];
  const pickedSongs: string[] = [];
  while (pool.length > 0 && picked.length < limit) {
    const fits = (p: (typeof pool)[number]) => fitsTail(p.artist, p.song, tail, tailSongs, opts);
    // Другой письменности меньше доли на целый трек — первым идёт подходящий трек другой письменности, если он есть.
    const foreign = scripts.filter((s) => s !== home).length;
    const owed = WAVE_FOREIGN_SHARE * (scripts.length + 1) - foreign >= 1;
    let i = owed ? pool.findIndex((p) => p.script !== home && fits(p)) : -1;
    if (i < 0) i = pool.findIndex(fits);
    if (i < 0) break;
    const [next] = pool.splice(i, 1);
    picked.push(next.track);
    pickedSongs.push(next.song);
    tail.push(next.artist);
    tailSongs.push(next.song);
    scripts.push(next.script);
  }

  return {
    picked,
    memory: {
      ...memory,
      ids: [...memory.ids, ...picked.map((p) => p.id)],
      songs: [...memory.songs, ...pickedSongs],
      tail: tail.slice(-TAIL),
      tailSongs: tailSongs.slice(-TAIL),
      scripts: scripts.slice(-SCRIPT_SPAN),
    },
  };
}

/** Трек уже стоит в волне (например, первый трек «Волны по треку»): запомнить его без отбора. */
export function rememberTracks(memory: WaveMemory, tracks: readonly Track[]): WaveMemory {
  const fresh = tracks.filter((t) => !memory.ids.includes(t.id));
  if (fresh.length === 0) return memory;
  return {
    ...memory,
    ids: [...memory.ids, ...fresh.map((t) => t.id)],
    songs: [...memory.songs, ...fresh.map(songKey)],
    tail: [...memory.tail, ...fresh.map(artistsKey)].slice(-TAIL),
    tailSongs: [...memory.tailSongs, ...fresh.map(songKey)].slice(-TAIL),
    scripts: [...memory.scripts, ...fresh.map(scriptOf)].slice(-SCRIPT_SPAN),
  };
}
