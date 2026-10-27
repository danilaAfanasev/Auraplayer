// Общие действия «Слушать» и «Перемешать» для списков (кнопки PlayButtons в шапках экранов).
import type { Track } from '../../../shared/types';
import { usePlayer } from '../../stores/usePlayer';

/** Играть список с первого трека; очередь — этот список, `title` — её заголовок (имя списка). */
export function playAll(tracks: Track[], title?: string): void {
  if (tracks.length > 0) usePlayer.getState().playList(tracks, 0, title);
}

/** Включить перемешивание и начать со случайного трека списка. */
export function playShuffled(tracks: Track[], title?: string): void {
  if (tracks.length === 0) return;
  if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
  usePlayer.getState().playList(tracks, Math.floor(Math.random() * tracks.length), title);
}
