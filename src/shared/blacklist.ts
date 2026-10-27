// Чёрный список: треки и исполнители, которых пользователь больше не хочет слышать. Чистые функции,
// общие для main и renderer; хранится в `library.json` (`LibraryData.blacklist`).
// Трек скрыт по id или как та же песня из другого источника (`songKey`); исполнитель — по `artistKey`
// любого из исполнителей трека, включая фиты в названии.
import { artistKey, splitArtists } from './artistNames';
import type { Track } from './types';
import { primaryArtist, songKey } from './wave';

export interface BlockedTrack {
  /** Снимок трека — чтобы показать его в настройках и вернуть. */
  track: Track;
  songKey: string;
  blockedAt: number;
}

export interface BlockedArtist {
  /** `artistKey(name)` */
  key: string;
  name: string;
  /** id артиста каталога, если блокировали со страницы артиста. */
  id?: string;
  imageUrl?: string;
  blockedAt: number;
}

export interface Blacklist {
  /** Новые — в начало. */
  tracks: BlockedTrack[];
  /** Новые — в начало. */
  artists: BlockedArtist[];
}

export interface ArtistToBlock {
  name: string;
  id?: string;
  imageUrl?: string;
}

export function emptyBlacklist(): Blacklist {
  return { tracks: [], artists: [] };
}

export function blockTrack(bl: Blacklist, track: Track, now: number): Blacklist {
  if (bl.tracks.some((b) => b.track.id === track.id)) return bl;
  return { ...bl, tracks: [{ track: { ...track }, songKey: songKey(track), blockedAt: now }, ...bl.tracks] };
}

export function unblockTrack(bl: Blacklist, trackId: string): Blacklist {
  if (!bl.tracks.some((b) => b.track.id === trackId)) return bl;
  return { ...bl, tracks: bl.tracks.filter((b) => b.track.id !== trackId) };
}

export function blockArtist(bl: Blacklist, artist: ArtistToBlock, now: number): Blacklist {
  const key = artistKey(artist.name);
  if (!key || bl.artists.some((a) => a.key === key)) return bl;
  const entry: BlockedArtist = { key, name: artist.name.trim(), blockedAt: now };
  if (artist.id) entry.id = artist.id;
  if (artist.imageUrl) entry.imageUrl = artist.imageUrl;
  return { ...bl, artists: [entry, ...bl.artists] };
}

export function unblockArtist(bl: Blacklist, key: string): Blacklist {
  if (!bl.artists.some((a) => a.key === key)) return bl;
  return { ...bl, artists: bl.artists.filter((a) => a.key !== key) };
}

// ---------- проверки ----------

interface Matcher {
  ids: Set<string>;
  songs: Set<string>;
  artists: Set<string>;
}

/** Списки проверяются целиком (сотни треков): множества строятся один раз на каждый чёрный список. */
const matchers = new WeakMap<Blacklist, Matcher>();

function matcherOf(bl: Blacklist): Matcher {
  let m = matchers.get(bl);
  if (!m) {
    m = {
      ids: new Set(bl.tracks.map((b) => b.track.id)),
      songs: new Set(bl.tracks.filter((b) => primaryArtist(b.track)).map((b) => b.songKey)),
      artists: new Set(bl.artists.map((a) => a.key)),
    };
    matchers.set(bl, m);
  }
  return m;
}

/** Трек скрыт сам: по id или та же песня из другого источника (у трека без исполнителя — только по id). */
export function isTrackBlocked(track: Track, bl: Blacklist): boolean {
  if (bl.tracks.length === 0) return false;
  const m = matcherOf(bl);
  if (m.ids.has(track.id)) return true;
  return primaryArtist(track) !== '' && m.songs.has(songKey(track));
}

export function isArtistBlocked(name: string, bl: Blacklist): boolean {
  if (bl.artists.length === 0) return false;
  const key = artistKey(name);
  return key !== '' && matcherOf(bl).artists.has(key);
}

/** Почему трек скрыт: сам трек или кто-то из его исполнителей (в поле исполнителя или на фите в названии). */
export function blockReason(track: Track, bl: Blacklist): 'track' | 'artist' | null {
  if (isTrackBlocked(track, bl)) return 'track';
  if (bl.artists.length === 0) return null;
  const { artists } = matcherOf(bl);
  // Исполнитель, скрытый строкой целиком («HammAli & Navai»), — по ключу всей строки исполнителя.
  if (artists.has(artistKey(track.artist))) return 'artist';
  return splitArtists(track.artist, track.title).some((name) => artists.has(artistKey(name))) ? 'artist' : null;
}

export function isBlocked(track: Track, bl: Blacklist): boolean {
  return blockReason(track, bl) !== null;
}

/** Список без скрытых треков, порядок сохраняется. */
export function withoutBlocked<T>(items: T[], bl: Blacklist, get: (x: T) => Track): T[] {
  if (bl.tracks.length === 0 && bl.artists.length === 0) return items;
  return items.filter((x) => !isBlocked(get(x), bl));
}

// ---------- проверка данных, прочитанных с диска ----------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isTrack(v: unknown): v is Track {
  return (
    isObject(v) &&
    isString(v.id) &&
    isString(v.source) &&
    v.source.length > 0 &&
    isString(v.sourceId) &&
    isString(v.title) &&
    isString(v.artist) &&
    typeof v.downloadable === 'boolean'
  );
}

/** Битые записи и повторы отбрасываются; ключи песни и исполнителя пересчитываются. */
export function normalizeBlacklist(raw: unknown): Blacklist {
  if (!isObject(raw)) return emptyBlacklist();
  const tracks: BlockedTrack[] = [];
  const seenTracks = new Set<string>();
  if (Array.isArray(raw.tracks)) {
    for (const b of raw.tracks) {
      if (!isObject(b) || !isTrack(b.track) || seenTracks.has(b.track.id)) continue;
      seenTracks.add(b.track.id);
      tracks.push({ track: b.track, songKey: songKey(b.track), blockedAt: isNumber(b.blockedAt) ? b.blockedAt : 0 });
    }
  }
  const artists: BlockedArtist[] = [];
  const seenArtists = new Set<string>();
  if (Array.isArray(raw.artists)) {
    for (const a of raw.artists) {
      if (!isObject(a) || !isString(a.name)) continue;
      const key = artistKey(a.name);
      if (!key || seenArtists.has(key)) continue;
      seenArtists.add(key);
      const entry: BlockedArtist = { key, name: a.name.trim(), blockedAt: isNumber(a.blockedAt) ? a.blockedAt : 0 };
      if (isString(a.id) && a.id.trim()) entry.id = a.id;
      if (isString(a.imageUrl) && a.imageUrl.startsWith('https://')) entry.imageUrl = a.imageUrl;
      artists.push(entry);
    }
  }
  return { tracks, artists };
}
