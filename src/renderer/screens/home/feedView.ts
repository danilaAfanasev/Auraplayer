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

/**
 * Лента собрана не по нынешним подпискам (подписался, а пересборка сорвалась или ещё не дошла):
 * её «пусто» — не «у артистов ничего не выходило». Отписка не в счёт — лишнее и так отфильтровано.
 */
export function isFeedOutdated(feedFollowedIds: readonly string[], currentFollowIds: readonly string[]): boolean {
  const built = new Set(feedFollowedIds);
  return currentFollowIds.some((id) => !built.has(id));
}

/** Что показать в блоке ленты. */
export type FeedBlockState = 'items' | 'loading' | 'offline' | 'error' | 'empty';

export interface FeedBlockInput {
  count: number;
  /** Первый снимок ещё не пришёл. */
  loading: boolean;
  refreshing: boolean;
  error: ArtistFeedSnapshot['error'];
  /** `isFeedOutdated`. */
  outdated: boolean;
}

/**
 * Пусто — это «ничего не выходило», только если лента собрана по нынешним подпискам и без сбоя.
 * Идёт сборка, а показать нечего — «Собираю…»; сбой — честно: «Не удалось обновить ленту — Повторить».
 */
export function feedBlockState({ count, loading, refreshing, error, outdated }: FeedBlockInput): FeedBlockState {
  if (count > 0) return 'items';
  if (loading || refreshing) return 'loading';
  if (error) return error.kind === 'offline' ? 'offline' : 'error';
  // Собрана для других подписок, но без сбоя: пересборка вот-вот начнётся (пауза после подписки) — «Собираю…».
  if (outdated) return 'loading';
  return 'empty';
}