import { describe, expect, it } from 'vitest';
import type { ArtistFeedSnapshot } from '../../../shared/api';
import type { ArtistRelease } from '../../../shared/types';
import { blockArtist, blockTrack, emptyBlacklist } from '../../../shared/blacklist';
import { visibleFeed } from './feedView';

const r = (id: string, artistId: string, date: string, similarTo?: string): ArtistRelease => ({
  id,
  title: `Релиз ${id}`,
  artist: `Артист ${artistId}`,
  artistId,
  kind: 'single',
  releaseDate: date,
  trackCount: 1,
  ...(similarTo ? { similarTo: { id: similarTo, name: `Подписка ${similarTo}` } } : {}),
});

const feed: ArtistFeedSnapshot = {
  updatedAt: 1,
  followed: [r('1', 'a', '2026-10-20'), r('2', 'b', '2026-10-10')],
  similar: [r('3', 'x', '2026-10-15', 'a'), r('4', 'y', '2026-10-01', 'b'), r('5', 'b', '2026-09-30', 'a')],
  followedIds: ['a', 'b'],
  refreshing: false,
  error: null,
};

describe('visibleFeed', () => {
  it('после отписки (лента ещё не пересобрана) — без релизов отписанного и похожих на него', () => {
    const view = visibleFeed(feed, ['a']);
    expect(view.followed.map((x) => x.id)).toEqual(['1']);
    expect(view.similar.map((x) => x.id)).toEqual(['3', '5']);
  });

  it('подписки сами в «Свежем от похожих» не показываются', () => {
    expect(visibleFeed(feed, ['a', 'b']).similar.map((x) => x.id)).toEqual(['3', '4']);
  });

  it('баннер — самый свежий релиз подписок', () => {
    expect(visibleFeed(feed, ['a', 'b']).hero?.id).toBe('1');
    expect(visibleFeed(feed, []).hero).toBeNull();
  });
});

describe('visibleFeed: чёрный список', () => {
  const bl = (artists: string[], tracks: { artist: string; title: string }[] = []) => {
    let list = emptyBlacklist();
    for (const name of artists) list = blockArtist(list, { name }, 1);
    for (const t of tracks) list = blockTrack(list, { id: `catalog:${t.title}`, source: 'catalog', sourceId: '1', downloadable: false, ...t }, 1);
    return list;
  };

  it('релизы скрытого исполнителя (и с ним на фите) не видны ни в подписках, ни в «Свежем от похожих»', () => {
    const withFeat: ArtistRelease = { ...r('6', 'z', '2026-10-12', 'a'), artist: 'Артист z feat. Артист x' };
    const view = visibleFeed({ followed: feed.followed, similar: [...feed.similar, withFeat] }, ['a', 'b'], bl(['Артист x', 'Артист b']));
    expect(view.followed.map((x) => x.id)).toEqual(['1']);
    expect(view.similar.map((x) => x.id)).toEqual(['4']);
  });

  it('сингл со скрытым треком не виден; альбом с таким же названием — виден', () => {
    const album: ArtistRelease = { ...r('7', 'a', '2026-10-05'), kind: 'album', title: 'Релиз 1', trackCount: 10 };
    const view = visibleFeed({ followed: [...feed.followed, album], similar: [] }, ['a', 'b'], bl([], [{ artist: 'Артист a', title: 'Релиз 1' }]));
    expect(view.followed.map((x) => x.id)).toEqual(['2', '7']);
    expect(view.hero?.id).toBe('2');
  });
});
