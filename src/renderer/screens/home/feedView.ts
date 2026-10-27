// Что из ленты артистов показать сейчас: лента собирается в main по подпискам на момент сборки,
// а отписка и чёрный список видны сразу — релизы отписанных, похожих только на них и скрытых исполнителей
// (и синглы скрытых треков) не показываются до пересборки.
import type { ArtistFeedSnapshot } from '../../../shared/api';
import { splitArtists } from '../../../shared/artistNames';
import { isArtistBlocked, isTrackBlocked, type Blacklist } from '../../../shared/blacklist';
import type { ArtistRelease, Track } from '../../../shared/types';
import { useLibrary } from '../../stores/useLibrary';

export interface FeedView {
  followed: ArtistRelease[];
  similar: ArtistRelease[];
  /** Баннер главной — самый свежий релиз подписок. */
  hero: ArtistRelease | null;
}

/** Релиз скрытого исполнителя (основного или на фите) или сингл скрытого трека. */
export function isReleaseBlocked(release: ArtistRelease, bl: Blacklist): boolean {
  if (bl.artists.length > 0 && splitArtists(release.artist, release.title).some((name) => isArtistBlocked(name, bl))) return true;
  if (release.kind !== 'single' || bl.tracks.length === 0) return false;
  const asTrack: Track = { id: `release:${release.id}`, source: 'catalog', sourceId: release.id, title: release.title, artist: release.artist, downloadable: false };
  return isTrackBlocked(asTrack, bl);
}

/** `bl` — чёрный список; не передан — текущий из библиотеки. */
export function visibleFeed(
  feed: Pick<ArtistFeedSnapshot, 'followed' | 'similar'>,
  followedIds: readonly string[],
  bl: Blacklist = useLibrary.getState().lib.blacklist,
): FeedView {
  const ids = new Set(followedIds);
  const shown = (r: ArtistRelease) => !isReleaseBlocked(r, bl);
  const followed = feed.followed.filter((r) => ids.has(r.artistId) && shown(r));
  const similar = feed.similar.filter((r) => !ids.has(r.artistId) && (!r.similarTo || ids.has(r.similarTo.id)) && shown(r));
  return { followed, similar, hero: followed[0] ?? null };
}
