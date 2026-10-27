// Пункты контекстного меню трека (правый клик, клавиша меню, «⋯»): одно меню на очередь справа, «Недавно» и все
// таблицы треков. Чистая функция: что показать в этом месте; действия выполняет `TrackMenu.tsx`.
import { splitArtists } from '../../../shared/artistNames';
import type { Track } from '../../../shared/types';

/** Где открыто меню: очередь справа, «Недавно» справа или таблица треков. */
export type TrackMenuPlace = 'queue' | 'recent' | 'table';

export type TrackMenuIcon = 'like' | 'unlike' | 'dislike' | 'playNext' | 'remove' | 'playlist' | 'download' | 'cancel' | 'wave' | 'artist' | 'album';

export type TrackMenuAction =
  | { kind: 'like' }
  | { kind: 'dislike' }
  | { kind: 'playNext' }
  | { kind: 'removeFromQueue' }
  | { kind: 'addToPlaylist' }
  | { kind: 'download' }
  | { kind: 'cancelDownload' }
  | { kind: 'wave' }
  | { kind: 'artist'; name: string }
  | { kind: 'album'; releaseId: string };

export interface TrackMenuEntry {
  /** Уникален в меню. */
  key: string;
  label: string;
  icon: TrackMenuIcon;
  danger?: boolean;
  action: TrackMenuAction;
}

/** Состояние скачивания трека: `active` — в очереди или качается. */
export type TrackDownloadState = 'none' | 'active' | 'done';

export interface TrackMenuInput {
  track: Track;
  place: TrackMenuPlace;
  liked: boolean;
  /** Этот трек играет сейчас (текущий в плеере). */
  current: boolean;
  /** Очередь: трек — в ещё не сыгранной части. */
  upcoming?: boolean;
  /** Трек в чёрном списке (приглушённая строка своего списка). */
  blocked?: boolean;
  download: TrackDownloadState;
}

/** id альбома трека каталога — из адреса его страницы (`…/album/<название>/<id>?i=<трек>`); не известен — null. */
export function albumIdOf(track: Pick<Track, 'source' | 'pageUrl'>): string | null {
  if (track.source !== 'catalog' || !track.pageUrl) return null;
  return /\/album\/[^/?#]+\/(\d+)(?:[?#]|$)/.exec(track.pageUrl)?.[1] ?? null;
}

/**
 * Пункты меню по порядку: «Мне нравится», «Не нравится», «Играть следующим», «Убрать из очереди» (только будущие
 * в очереди), «В плейлист…», «Скачать», «Волна по треку», исполнители, «Перейти к альбому» (если известен).
 * Бессмысленные здесь пункты не показываются.
 */
export function trackMenuItems({ track, place, liked, current, upcoming = false, blocked = false, download }: TrackMenuInput): TrackMenuEntry[] {
  const out: TrackMenuEntry[] = [];
  out.push(
    liked
      ? { key: 'like', label: 'Убрать из «Мне нравится»', icon: 'unlike', action: { kind: 'like' } }
      : { key: 'like', label: 'Мне нравится', icon: 'like', action: { kind: 'like' } },
  );
  if (!blocked) out.push({ key: 'dislike', label: 'Не нравится', icon: 'dislike', danger: true, action: { kind: 'dislike' } });
  if (!current && !blocked) out.push({ key: 'playNext', label: 'Играть следующим', icon: 'playNext', action: { kind: 'playNext' } });
  if (place === 'queue' && upcoming && !current) out.push({ key: 'remove', label: 'Убрать из очереди', icon: 'remove', action: { kind: 'removeFromQueue' } });
  out.push({ key: 'playlist', label: 'В плейлист…', icon: 'playlist', action: { kind: 'addToPlaylist' } });
  if (track.source !== 'local' && track.downloadable) {
    if (download === 'none') out.push({ key: 'download', label: 'Скачать', icon: 'download', action: { kind: 'download' } });
    else if (download === 'active') out.push({ key: 'download', label: 'Отменить скачивание', icon: 'cancel', action: { kind: 'cancelDownload' } });
  }
  if (!blocked) out.push({ key: 'wave', label: 'Волна по треку', icon: 'wave', action: { kind: 'wave' } });
  const artists = splitArtists(track.artist, track.title);
  if (artists.length === 1) out.push({ key: 'artist', label: 'Перейти к исполнителю', icon: 'artist', action: { kind: 'artist', name: artists[0] } });
  else
    for (const [i, name] of artists.entries())
      out.push({ key: `artist:${i}`, label: `Исполнитель: ${name}`, icon: 'artist', action: { kind: 'artist', name } });
  const album = albumIdOf(track);
  if (album) out.push({ key: 'album', label: 'Перейти к альбому', icon: 'album', action: { kind: 'album', releaseId: album } });
  return out;
}

/** Где открыть меню: у курсора; с клавиатуры (клавиша меню, Shift+F10) курсора нет — у строки. */
export function menuPoint(e: { clientX: number; clientY: number }, rect: { left: number; top: number; right: number; bottom: number }): { x: number; y: number } {
  const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (inside && (e.clientX !== 0 || e.clientY !== 0)) return { x: e.clientX, y: e.clientY };
  return { x: rect.left + 24, y: rect.bottom - 4 };
}
