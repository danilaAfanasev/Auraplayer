// Волна: чистая логика отбора треков — без дублей, без «не понравившихся» исполнителей,
// один исполнитель не больше двух раз подряд. Общая для main и renderer.
import { artistKey, splitArtists } from './artistNames';
import type { Track } from './types';

/** Один и тот же исполнитель — не больше стольких треков подряд. */
export const MAX_SAME_ARTIST_IN_ROW = 2;

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
  /** Исполнители последних треков очереди (`artistsKey`), последний — в конце: правило «не больше 2 подряд». */
  tail: string[];
}

export function emptyWaveMemory(): WaveMemory {
  return { ids: [], songs: [], bannedIds: [], bannedArtists: [], tail: [] };
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

/** Встал бы кто-то из исполнителей трека (в том числе на фите) третьим подряд. */
function tooManyInRow(tail: readonly string[], artists: string): boolean {
  if (!artists || tail.length < MAX_SAME_ARTIST_IN_ROW) return false;
  const last = tail.slice(-MAX_SAME_ARTIST_IN_ROW).map((k) => k.split(KEY_SEP));
  return artists.split(KEY_SEP).some((a) => last.every((keys) => keys.includes(a)));
}

/**
 * Следующая порция волны из кандидатов (в их порядке): без уже бывших в волне (по id и по песне),
 * без «не понравившихся», один исполнитель (и на фитах) не больше двух раз подряд — лишний трек ждёт, пока его
 * разбавит другой исполнитель, а если разбавить нечем, не берётся. Возвращает и обновлённую память.
 */
export function pickWaveTracks(candidates: readonly Track[], memory: WaveMemory, limit = Infinity): { picked: Track[]; memory: WaveMemory } {
  const ids = new Set(memory.ids);
  const songs = new Set(memory.songs);
  const pool: { track: Track; song: string; artist: string }[] = [];
  for (const track of candidates) {
    const song = songKey(track);
    if (ids.has(track.id) || songs.has(song) || isBanned(track, memory)) continue;
    if (pool.some((p) => p.track.id === track.id || p.song === song)) continue;
    pool.push({ track, song, artist: artistsKey(track) });
  }

  const tail = memory.tail.slice();
  const picked: Track[] = [];
  const pickedSongs: string[] = [];
  while (pool.length > 0 && picked.length < limit) {
    const i = pool.findIndex((p) => !tooManyInRow(tail, p.artist));
    if (i < 0) break;
    const [next] = pool.splice(i, 1);
    picked.push(next.track);
    pickedSongs.push(next.song);
    tail.push(next.artist);
  }

  return {
    picked,
    memory: {
      ...memory,
      ids: [...memory.ids, ...picked.map((p) => p.id)],
      songs: [...memory.songs, ...pickedSongs],
      tail: tail.slice(-MAX_SAME_ARTIST_IN_ROW),
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
    tail: [...memory.tail, ...fresh.map(artistsKey)].slice(-MAX_SAME_ARTIST_IN_ROW),
  };
}
