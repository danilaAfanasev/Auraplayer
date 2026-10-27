// Строка своего списка или поиска со скрытым треком: почему он скрыт и что вернуть, чтобы скрытие снялось.
import { artistKey, splitArtists } from '../../../shared/artistNames';
import { blockReason, isTrackBlocked, type Blacklist } from '../../../shared/blacklist';
import type { Track } from '../../../shared/types';

export interface BlockedBy {
  reason: 'track' | 'artist';
  /** Записи скрытых треков, под которые подходит этот (по id или та же песня из другого источника). */
  trackIds: string[];
  /** Скрытые исполнители этого трека (`artistKey`, в том числе с фита в названии). */
  artistKeys: string[];
  /** Пометка в строке. */
  label: string;
}

export function blockedBy(track: Track, bl: Blacklist): BlockedBy | null {
  const reason = blockReason(track, bl);
  if (!reason) return null;
  const trackIds = bl.tracks.filter((b) => isTrackBlocked(track, { tracks: [b], artists: [] })).map((b) => b.track.id);
  const keys = new Set(bl.artists.map((a) => a.key));
  const artistKeys = [...new Set(splitArtists(track.artist, track.title).map(artistKey))].filter((k) => keys.has(k));
  return { reason, trackIds, artistKeys, label: reason === 'track' ? 'в чёрном списке' : 'исполнитель в чёрном списке' };
}
