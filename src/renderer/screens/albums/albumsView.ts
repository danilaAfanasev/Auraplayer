// Что показать в разделе «Альбомы»: сохранённые снимки релизов без скрытых исполнителей, новые первыми.
import type { Blacklist } from '../../../shared/blacklist';
import { pluralRu } from '../../../shared/format';
import type { ArtistRelease, LikedAlbum } from '../../../shared/types';
import { isReleaseBlocked } from '../home/feedView';

/** Новые (по времени сохранения) первыми; релизы скрытых исполнителей — не показываются, но в файле остаются. */
export function visibleAlbums(liked: readonly LikedAlbum[], bl: Blacklist): ArtistRelease[] {
  return liked
    .filter((a) => !isReleaseBlocked(a.release, bl))
    .sort((a, b) => b.likedAt - a.likedAt)
    .map((a) => a.release);
}

/** «12 альбомов» — счётчик в шапке. */
export const albumsCountLabel = (n: number): string => `${n} ${pluralRu(n, 'альбом', 'альбома', 'альбомов')}`;
