// Операции над личной библиотекой. Каждая функция чистая и возвращает новый объект.
import { nanoid } from 'nanoid';
import { artistKey } from './artistNames';
import * as blacklist from './blacklist';
import { cleanRelease } from './release';
import { addTasteEvents, cleanGenres, emptyTaste, normalizeTaste, type TasteEvent } from './taste';
import {
  SOURCE_IDS,
  type ArtistRef,
  type ArtistRelease,
  type FollowedArtist,
  type HistoryEntry,
  type LibraryData,
  type LikedAlbum,
  type Playlist,
  type Track,
} from './types';

export const HISTORY_LIMIT = 100;
export const DEFAULT_PLAYLIST_NAME = 'Новый плейлист';

export function emptyLibrary(): LibraryData {
  return {
    version: 1,
    tracks: {},
    playlists: [],
    likes: [],
    history: [],
    followedArtists: [],
    likedAlbums: [],
    blacklist: blacklist.emptyBlacklist(),
    taste: emptyTaste(),
  };
}

/**
 * Оставляет в `tracks` только снимки треков, упомянутых в плейлистах, лайках или истории.
 * Снимки скрытых треков лежат в самом чёрном списке (`blacklist.tracks[].track`) — их это не касается.
 */
function pruneTracks(lib: LibraryData): LibraryData {
  const used = new Set<string>(lib.likes);
  for (const p of lib.playlists) for (const id of p.trackIds) used.add(id);
  for (const h of lib.history) used.add(h.trackId);
  const tracks: Record<string, Track> = {};
  for (const id of used) if (lib.tracks[id]) tracks[id] = lib.tracks[id];
  return { ...lib, tracks };
}

function withTrack(lib: LibraryData, track: Track): Record<string, Track> {
  return { ...lib.tracks, [track.id]: { ...track } };
}

function updatePlaylist(lib: LibraryData, id: string, fn: (p: Playlist) => Playlist): LibraryData {
  let changed = false;
  const playlists = lib.playlists.map((p) => {
    if (p.id !== id) return p;
    changed = true;
    return fn(p);
  });
  return changed ? { ...lib, playlists } : lib;
}

export function createPlaylist(
  lib: LibraryData,
  name: string,
  opts: { id?: string; now?: number } = {},
): { lib: LibraryData; playlist: Playlist } {
  const now = opts.now ?? Date.now();
  const playlist: Playlist = {
    id: opts.id ?? nanoid(),
    name: name.trim() || DEFAULT_PLAYLIST_NAME,
    trackIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return { lib: { ...lib, playlists: [...lib.playlists, playlist] }, playlist };
}

export function renamePlaylist(lib: LibraryData, id: string, name: string, now = Date.now()): LibraryData {
  const clean = name.trim();
  if (!clean) return lib;
  return updatePlaylist(lib, id, (p) => ({ ...p, name: clean, updatedAt: now }));
}

export function deletePlaylist(lib: LibraryData, id: string): LibraryData {
  if (!lib.playlists.some((p) => p.id === id)) return lib;
  return pruneTracks({ ...lib, playlists: lib.playlists.filter((p) => p.id !== id) });
}

/** `added: false` — трек уже был в плейлисте (или плейлиста нет). */
export function addToPlaylist(
  lib: LibraryData,
  id: string,
  track: Track,
  now = Date.now(),
): { lib: LibraryData; added: boolean } {
  const playlist = lib.playlists.find((p) => p.id === id);
  if (!playlist || playlist.trackIds.includes(track.id)) return { lib, added: false };
  const next = updatePlaylist(lib, id, (p) => ({ ...p, trackIds: [...p.trackIds, track.id], updatedAt: now }));
  return { lib: { ...next, tracks: withTrack(lib, track) }, added: true };
}

export function removeFromPlaylist(lib: LibraryData, id: string, trackId: string, now = Date.now()): LibraryData {
  const playlist = lib.playlists.find((p) => p.id === id);
  if (!playlist || !playlist.trackIds.includes(trackId)) return lib;
  return pruneTracks(
    updatePlaylist(lib, id, (p) => ({ ...p, trackIds: p.trackIds.filter((t) => t !== trackId), updatedAt: now })),
  );
}

export function movePlaylistTrack(lib: LibraryData, id: string, from: number, to: number, now = Date.now()): LibraryData {
  const playlist = lib.playlists.find((p) => p.id === id);
  if (!playlist) return lib;
  const n = playlist.trackIds.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return lib;
  return updatePlaylist(lib, id, (p) => {
    const trackIds = [...p.trackIds];
    const [moved] = trackIds.splice(from, 1);
    trackIds.splice(to, 0, moved);
    return { ...p, trackIds, updatedAt: now };
  });
}

/**
 * Куда в `movePlaylistTrack` отправить строку `from`, брошенную на строку `over`
 * (`placeAfter` — в нижней половине строки). `null` — строка и так стоит на этом месте.
 */
export function reorderTarget(from: number, over: number, placeAfter: boolean): number | null {
  const insertAt = placeAfter ? over + 1 : over;
  const to = insertAt > from ? insertAt - 1 : insertAt;
  return to === from ? null : to;
}

export function isLiked(lib: LibraryData, trackId: string): boolean {
  return lib.likes.includes(trackId);
}

/** Ставит «нравится» (в начало списка) или снимает, если уже стоит. */
export function toggleLike(lib: LibraryData, track: Track): LibraryData {
  if (lib.likes.includes(track.id)) {
    return pruneTracks({ ...lib, likes: lib.likes.filter((id) => id !== track.id) });
  }
  return { ...lib, likes: [track.id, ...lib.likes], tracks: withTrack(lib, track) };
}

/** Запись в историю: новые — в начало, повтор того же трека поднимается наверх, не больше 100. */
export function pushHistory(lib: LibraryData, track: Track, at: number): LibraryData {
  const history: HistoryEntry[] = [
    { trackId: track.id, playedAt: at },
    ...lib.history.filter((h) => h.trackId !== track.id),
  ].slice(0, HISTORY_LIMIT);
  return pruneTracks({ ...lib, history, tracks: withTrack(lib, track) });
}

// ---------- подписки на артистов ----------

export function isFollowing(lib: LibraryData, artistId: string): boolean {
  return lib.followedArtists.some((a) => a.id === artistId);
}

function followed(artist: ArtistRef, now: number): FollowedArtist {
  const f: FollowedArtist = { id: artist.id, name: artist.name, followedAt: now };
  if (artist.imageUrl) f.imageUrl = artist.imageUrl;
  return f;
}

/** Подписки на всех из списка (уже подписанные пропускаются); новые — в начало, в порядке списка. */
export function followArtists(lib: LibraryData, artists: readonly ArtistRef[], now = Date.now()): LibraryData {
  const seen = new Set(lib.followedArtists.map((a) => a.id));
  const added: FollowedArtist[] = [];
  for (const a of artists) {
    if (!a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    added.push(followed(a, now));
  }
  return added.length === 0 ? lib : { ...lib, followedArtists: [...added, ...lib.followedArtists] };
}

/** Подписка на артиста (в начало списка); уже подписан — библиотека не меняется. */
export function followArtist(lib: LibraryData, artist: ArtistRef, now = Date.now()): LibraryData {
  return followArtists(lib, [artist], now);
}

export function unfollowArtist(lib: LibraryData, artistId: string): LibraryData {
  if (!isFollowing(lib, artistId)) return lib;
  return { ...lib, followedArtists: lib.followedArtists.filter((a) => a.id !== artistId) };
}

// ---------- чёрный список и вкус ----------

/** «Не нравится» на треке: трек в чёрном списке (со снимком), лайк с него снимается. */
export function blockTrack(lib: LibraryData, track: Track, now = Date.now()): LibraryData {
  const bl = blacklist.blockTrack(lib.blacklist, track, now);
  const liked = lib.likes.includes(track.id);
  if (bl === lib.blacklist && !liked) return lib;
  const next = { ...lib, blacklist: bl };
  return liked ? pruneTracks({ ...next, likes: lib.likes.filter((id) => id !== track.id) }) : next;
}

export function unblockTrack(lib: LibraryData, trackId: string): LibraryData {
  const bl = blacklist.unblockTrack(lib.blacklist, trackId);
  return bl === lib.blacklist ? lib : { ...lib, blacklist: bl };
}

export const isAlbumLiked = (lib: LibraryData, releaseId: string): boolean => lib.likedAlbums.some((a) => a.release.id === releaseId);

/**
 * Сохранить альбом или убрать, если он уже сохранён. Хранится снимок релиза; треки альбома не лайкаются и в
 * `tracks`/`likes` не попадают. Пометка ленты «похож на …» в снимок не берётся.
 */
export function toggleAlbumLike(lib: LibraryData, release: ArtistRelease, now = Date.now()): LibraryData {
  if (isAlbumLiked(lib, release.id)) return { ...lib, likedAlbums: lib.likedAlbums.filter((a) => a.release.id !== release.id) };
  const { similarTo: _similarTo, ...snapshot } = release;
  return { ...lib, likedAlbums: [{ release: snapshot, likedAt: now }, ...lib.likedAlbums] };
}

/** Исполнитель в чёрном списке: подписка на него снимается, во вкус — «Не нравится». */
export function blockArtist(lib: LibraryData, artist: blacklist.ArtistToBlock, now = Date.now()): LibraryData {
  const bl = blacklist.blockArtist(lib.blacklist, artist, now);
  if (bl === lib.blacklist) return lib;
  const key = artistKey(artist.name);
  const followedArtists = lib.followedArtists.filter((a) => !((artist.id && a.id === artist.id) || artistKey(a.name) === key));
  return {
    ...lib,
    blacklist: bl,
    followedArtists: followedArtists.length === lib.followedArtists.length ? lib.followedArtists : followedArtists,
    taste: addTasteEvents(lib.taste, [{ artist: artist.name, kind: 'dislike', at: now }]),
  };
}

export function unblockArtist(lib: LibraryData, key: string): LibraryData {
  const bl = blacklist.unblockArtist(lib.blacklist, key);
  return bl === lib.blacklist ? lib : { ...lib, blacklist: bl };
}

export function recordTaste(lib: LibraryData, events: TasteEvent[]): LibraryData {
  const taste = addTasteEvents(lib.taste, events);
  return taste === lib.taste ? lib : { ...lib, taste };
}

/** Жанры вкуса целиком (первый запуск): без повторов, не больше 8. */
export function setTasteGenres(lib: LibraryData, tags: readonly string[]): LibraryData {
  return { ...lib, taste: { ...lib.taste, genres: cleanGenres(tags) } };
}

/** Пользователь включил жанр: он — наверх жанров вкуса, самый старый сверх 8 уходит. */
export function recordGenre(lib: LibraryData, tag: string): LibraryData {
  const clean = tag.trim();
  if (!clean || lib.taste.genres[0] === clean) return lib;
  return setTasteGenres(lib, [clean, ...lib.taste.genres.filter((g) => g !== clean)]);
}

// ---------- проверка данных, прочитанных с диска ----------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Трек источника, убранного из приложения (Jamendo): id `jamendo:…` остаётся, чтобы лайки, плейлисты,
 * история и скачанная копия (запись загрузки с этим прежним id) его находили.
 */
export function isRetiredTrack(track: Pick<Track, 'id'>): boolean {
  const prefix = track.id.slice(0, Math.max(0, track.id.indexOf(':')));
  return !(SOURCE_IDS as readonly string[]).includes(prefix);
}

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

/**
 * Трек убранного источника остаётся в библиотеке под прежним id, но с источником, который приложение знает
 * (метки и кнопки не ломаются): «Файл», без скачивания и без страницы источника. Играет из скачанного файла.
 */
function keepRetired(t: Track): Track {
  if (SOURCE_IDS.includes(t.source) && !isRetiredTrack(t)) return t;
  const kept: Track = { ...t, source: 'local', downloadable: false };
  delete kept.pageUrl;
  return kept;
}

/** Сохранённые альбомы из файла: битые и повторы по id релиза отбрасываются, порядок файла сохраняется. */
export function normalizeLikedAlbums(raw: unknown): LikedAlbum[] {
  if (!Array.isArray(raw)) return [];
  const out: LikedAlbum[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (!isObject(a)) continue;
    const release = cleanRelease(a.release);
    if (!release || seen.has(release.id)) continue;
    seen.add(release.id);
    out.push({ release, likedAt: isNumber(a.likedAt) ? a.likedAt : 0 });
  }
  return out;
}

/** Приводит прочитанный JSON к `LibraryData`: битые записи отбрасываются, мусор — пустая библиотека. */
export function normalizeLibrary(raw: unknown): LibraryData {
  if (!isObject(raw)) return emptyLibrary();
  const tracks: Record<string, Track> = {};
  if (isObject(raw.tracks)) {
    for (const [id, t] of Object.entries(raw.tracks)) if (isTrack(t) && t.id === id) tracks[id] = keepRetired(t);
  }
  const known = (id: unknown): id is string => isString(id) && id in tracks;

  const playlists: Playlist[] = [];
  const seenPlaylists = new Set<string>();
  if (Array.isArray(raw.playlists)) {
    for (const p of raw.playlists) {
      if (!isObject(p) || !isString(p.id) || !isString(p.name) || seenPlaylists.has(p.id)) continue;
      seenPlaylists.add(p.id);
      const trackIds = Array.isArray(p.trackIds) ? [...new Set(p.trackIds.filter(known))] : [];
      const createdAt = isNumber(p.createdAt) ? p.createdAt : 0;
      playlists.push({
        id: p.id,
        name: p.name,
        trackIds,
        createdAt,
        updatedAt: isNumber(p.updatedAt) ? p.updatedAt : createdAt,
      });
    }
  }

  const likes = Array.isArray(raw.likes) ? [...new Set(raw.likes.filter(known))] : [];
  const history: HistoryEntry[] = Array.isArray(raw.history)
    ? raw.history
        .filter((h): h is HistoryEntry => isObject(h) && known(h.trackId) && isNumber(h.playedAt))
        .map((h) => ({ trackId: h.trackId, playedAt: h.playedAt }))
        .slice(0, HISTORY_LIMIT)
    : [];

  const followedArtists: FollowedArtist[] = [];
  const seenArtists = new Set<string>();
  if (Array.isArray(raw.followedArtists)) {
    for (const a of raw.followedArtists) {
      if (!isObject(a) || !isString(a.id) || !a.id.trim() || !isString(a.name) || !a.name.trim() || seenArtists.has(a.id)) continue;
      seenArtists.add(a.id);
      const f: FollowedArtist = { id: a.id, name: a.name, followedAt: isNumber(a.followedAt) ? a.followedAt : 0 };
      if (isString(a.imageUrl) && a.imageUrl.startsWith('https://')) f.imageUrl = a.imageUrl;
      followedArtists.push(f);
    }
  }

  const likedAlbums = normalizeLikedAlbums(raw.likedAlbums);

  // Чёрный список и вкус — свои ветки: id скрытых треков не обязаны быть в `tracks` (снимки — в самом списке).
  const bl = blacklist.normalizeBlacklist(raw.blacklist);
  const hidden: blacklist.Blacklist = { ...bl, tracks: bl.tracks.map((b) => ({ ...b, track: keepRetired(b.track) })) };
  const taste = normalizeTaste(raw.taste);

  return pruneTracks({ version: 1, tracks, playlists, likes, history, followedArtists, likedAlbums, blacklist: hidden, taste });
}
