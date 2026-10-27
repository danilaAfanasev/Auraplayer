// Действия чёрного списка — общие для всех кнопок: «Не нравится» в панели плеера, меню строки таблицы и очереди,
// «⋯» на странице артиста, «Вернуть» в настройках и тостах.
import { useMemo } from 'react';
import { artistKey, splitArtists } from '../../shared/artistNames';
import {
  blockArtist,
  blockTrack,
  emptyBlacklist,
  isBlocked,
  isTrackBlocked,
  withoutBlocked,
  type ArtistToBlock,
  type Blacklist,
} from '../../shared/blacklist';
import type { Track } from '../../shared/types';
import { useLibrary } from './useLibrary';
import { selectCurrentTrack, usePlayer } from './usePlayer';
import { useUi } from './useUi';

/**
 * «Не нравится» на треке: трек (и та же песня из других источников) — в чёрный список, лайк снимается,
 * исполнителям — «Не нравится» во вкус; из будущей части очереди он уходит, играющий — плеер листает дальше.
 * Тост «Трек скрыт» с «Вернуть» (вернёт и лайк).
 */
export function dislikeTrack(track: Track): void {
  const library = useLibrary.getState();
  const wasLiked = library.lib.likes.includes(track.id);
  library.blockTrack(track);
  const now = Date.now();
  library.recordTaste(splitArtists(track.artist, track.title).map((artist) => ({ artist, kind: 'dislike' as const, at: now })));

  const only = blockTrack(emptyBlacklist(), track, now);
  const player = usePlayer.getState();
  player.removeUpcoming((t) => isTrackBlocked(t, only));
  const current = selectCurrentTrack(usePlayer.getState());
  if (current && isTrackBlocked(current, only)) usePlayer.getState().next();

  useUi.getState().toast('Трек скрыт', {
    label: 'Вернуть',
    run: () => {
      restoreTrack(track.id);
      if (wasLiked && !useLibrary.getState().lib.likes.includes(track.id)) useLibrary.getState().toggleLike(track);
    },
  });
}

/** Вернуть трек из чёрного списка. */
export function restoreTrack(trackId: string): void {
  useLibrary.getState().unblockTrack(trackId);
}

/**
 * Исполнитель — в чёрный список (из «⋯» на его странице): подписка снимается, его треки (и с ним на фите)
 * уходят из будущей части очереди. Тост с «Вернуть» (вернёт и подписку).
 */
export function blockArtistEverywhere(artist: ArtistToBlock): void {
  const library = useLibrary.getState();
  const key = artistKey(artist.name);
  if (!key) return;
  const followed = library.lib.followedArtists.find((a) => (artist.id && a.id === artist.id) || artistKey(a.name) === key);
  library.blockArtist(artist);

  const only = blockArtist(emptyBlacklist(), artist, Date.now());
  usePlayer.getState().removeUpcoming((t) => isBlocked(t, only));

  useUi.getState().toast(`Больше не будешь слышать ${artist.name.trim()} в волнах и подборках`, {
    label: 'Вернуть',
    run: () => {
      restoreArtist(key);
      if (followed) useLibrary.getState().follow(followed);
    },
  });
}

/** Вернуть исполнителя из чёрного списка (по `artistKey`). */
export function restoreArtist(key: string): void {
  useLibrary.getState().unblockArtist(key);
}

/** Чёрный список пользователя (селектор `useLibrary`). */
export const useBlacklist = (): Blacklist => useLibrary((s) => s.lib.blacklist);

/** Список без скрытых треков — для подборок, где скрытое не показывается. Тот же массив, пока ничего не скрыто. */
export function useVisibleTracks(tracks: Track[]): Track[] {
  const bl = useBlacklist();
  return useMemo(() => withoutBlocked(tracks, bl, (t) => t), [tracks, bl]);
}
