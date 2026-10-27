// Библиотека: плейлисты, «Мне нравится», история, подписки на артистов, чёрный список и вкус. Обёртки над shared/library.ts,
// сохранение через aura.library.save с задержкой 300 мс.
import { create } from 'zustand';
import type { ArtistToBlock } from '../../shared/blacklist';
import * as ops from '../../shared/library';
import type { TasteEvent } from '../../shared/taste';
import type { ArtistRef, ArtistRelease, LibraryData, Playlist, Track } from '../../shared/types';
import { errorMessage } from '../app/errors';
import { createDebouncedSaver } from './persist';
import { useUi } from './useUi';

interface LibraryState {
  lib: LibraryData;
  loaded: boolean;
  load(): Promise<void>;
  createPlaylist(name: string): Playlist;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  /** `false` — трек уже был в плейлисте. */
  addToPlaylist(id: string, track: Track): boolean;
  removeFromPlaylist(id: string, trackId: string): void;
  movePlaylistTrack(id: string, from: number, to: number): void;
  /** Возвращает новое состояние «нравится». */
  toggleLike(track: Track): boolean;
  /** Сохранить альбом снимком или убрать; треки альбома не лайкаются. Возвращает новое состояние «сохранён». */
  toggleAlbumLike(release: ArtistRelease): boolean;
  pushHistory(track: Track, at?: number): void;
  follow(artist: ArtistRef): void;
  /** «Подписаться на всех»: уже подписанные пропускаются. */
  followMany(artists: readonly ArtistRef[]): void;
  unfollow(artistId: string): void;
  /** Трек — в чёрный список; лайк с него снимается. */
  blockTrack(track: Track): void;
  unblockTrack(trackId: string): void;
  /** Исполнитель — в чёрный список; подписка снимается, во вкус — «Не нравится». */
  blockArtist(artist: ArtistToBlock): void;
  unblockArtist(key: string): void;
  recordTaste(events: TasteEvent[]): void;
  /** Жанры вкуса целиком (первый запуск). */
  setTasteGenres(tags: string[]): void;
  /** Пользователь включил жанр — наверх жанров вкуса. */
  recordGenre(tag: string): void;
}

const saver = createDebouncedSaver<LibraryData>(
  (lib) => window.aura.library.save(lib),
  (err) => useUi.getState().toast(`Не удалось сохранить библиотеку: ${errorMessage(err)}`, undefined, 'error'),
);

/**
 * Сохранять можно только после успешной загрузки: если library.json не прочитался (занят, нет доступа),
 * запись пустой библиотеки затёрла бы настоящую.
 */
let canSave = false;

export const useLibrary = create<LibraryState>((set, get) => {
  const commit = (lib: LibraryData) => {
    if (lib === get().lib) return;
    set({ lib });
    // Подписчики (трекер вкуса) могли внутри `set` уже записать своё поверх `lib` — сохраняем то, что в сторе сейчас.
    if (canSave) saver.schedule(get().lib);
  };

  return {
    lib: ops.emptyLibrary(),
    loaded: false,

    async load() {
      try {
        set({ lib: await window.aura.library.load(), loaded: true });
        canSave = true;
      } catch (err) {
        set({ loaded: true });
        useUi
          .getState()
          .toast(
            `Не удалось загрузить библиотеку: ${errorMessage(err)}. Изменения пока не сохраняются`,
            { label: 'Повторить', run: () => void get().load() },
            'error',
          );
      }
    },

    createPlaylist(name) {
      const { lib, playlist } = ops.createPlaylist(get().lib, name);
      commit(lib);
      return playlist;
    },
    renamePlaylist(id, name) {
      commit(ops.renamePlaylist(get().lib, id, name));
    },
    deletePlaylist(id) {
      commit(ops.deletePlaylist(get().lib, id));
    },
    addToPlaylist(id, track) {
      const { lib, added } = ops.addToPlaylist(get().lib, id, track);
      commit(lib);
      return added;
    },
    removeFromPlaylist(id, trackId) {
      commit(ops.removeFromPlaylist(get().lib, id, trackId));
    },
    movePlaylistTrack(id, from, to) {
      commit(ops.movePlaylistTrack(get().lib, id, from, to));
    },
    toggleLike(track) {
      const lib = ops.toggleLike(get().lib, track);
      commit(lib);
      return ops.isLiked(lib, track.id);
    },
    toggleAlbumLike(release) {
      const lib = ops.toggleAlbumLike(get().lib, release);
      commit(lib);
      return ops.isAlbumLiked(lib, release.id);
    },
    pushHistory(track, at = Date.now()) {
      commit(ops.pushHistory(get().lib, track, at));
    },
    follow(artist) {
      commit(ops.followArtist(get().lib, artist));
    },
    followMany(artists) {
      commit(ops.followArtists(get().lib, artists));
    },
    unfollow(artistId) {
      commit(ops.unfollowArtist(get().lib, artistId));
    },
    blockTrack(track) {
      commit(ops.blockTrack(get().lib, track));
    },
    unblockTrack(trackId) {
      commit(ops.unblockTrack(get().lib, trackId));
    },
    blockArtist(artist) {
      commit(ops.blockArtist(get().lib, artist));
    },
    unblockArtist(key) {
      commit(ops.unblockArtist(get().lib, key));
    },
    recordTaste(events) {
      commit(ops.recordTaste(get().lib, events));
    },
    setTasteGenres(tags) {
      commit(ops.setTasteGenres(get().lib, tags));
    },
    recordGenre(tag) {
      commit(ops.recordGenre(get().lib, tag));
    },
  };
});

export const flushLibrary = (): Promise<void> => saver.flush();

/** Селектор: стоит ли «нравится» у трека. */
export const useIsLiked = (trackId: string): boolean => useLibrary((s) => s.lib.likes.includes(trackId));

/** Селектор: сохранён ли альбом (по id релиза). */
export const useIsAlbumLiked = (releaseId: string): boolean => useLibrary((s) => s.lib.likedAlbums.some((a) => a.release.id === releaseId));

/** Селектор: подписан ли пользователь на артиста. */
export const useIsFollowing = (artistId: string): boolean => useLibrary((s) => s.lib.followedArtists.some((a) => a.id === artistId));
