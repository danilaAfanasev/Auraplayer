import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistFeedSnapshot } from '../../shared/api';
import type { LibraryData } from '../../shared/types';

const EMPTY_FEED: ArtistFeedSnapshot = { updatedAt: null, followed: [], similar: [], followedIds: [], refreshing: false, error: null };

let events: string[];
let feedStore: typeof import('./useFeed');
let library: typeof import('./useLibrary');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  events = [];
  vi.stubGlobal('window', {
    aura: {
      library: {
        load: async () => (await import('../../shared/library')).emptyLibrary(),
        save: async (lib: LibraryData) => void events.push(`save:${lib.followedArtists.map((a) => a.name).join(',')}`),
      },
      artists: {
        feed: async () => EMPTY_FEED,
        refreshFeed: async () => {
          events.push('refreshFeed');
          return { ...EMPTY_FEED, followedIds: ['1'] };
        },
        onFeed: () => () => undefined,
      },
    },
  });
  library = await import('./useLibrary');
  feedStore = await import('./useFeed');
  await library.useLibrary.getState().load();
  feedStore.initFeed();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('лента после подписки', () => {
  it('подписка → library.json дописан, затем лента собирается заново (одна сборка на несколько подписок подряд)', async () => {
    library.useLibrary.getState().follow({ id: '1', name: 'madk1d' });
    library.useLibrary.getState().follow({ id: '2', name: 'SALUKI' });
    await vi.advanceTimersByTimeAsync(feedStore.FEED_REFRESH_DELAY_MS + 50);
    expect(events).toEqual(['save:SALUKI,madk1d', 'refreshFeed']);
    expect(feedStore.useFeed.getState().followedIds).toEqual(['1']);
  });

  it('отписка тоже пересобирает ленту; другие изменения библиотеки (лайк) — нет', async () => {
    library.useLibrary.getState().toggleLike({ id: 'archive:x', source: 'archive', sourceId: 'x', title: 'X', artist: 'Y', downloadable: true });
    await vi.advanceTimersByTimeAsync(feedStore.FEED_REFRESH_DELAY_MS + 50);
    expect(events.filter((e) => e === 'refreshFeed')).toEqual([]);

    library.useLibrary.getState().follow({ id: '1', name: 'madk1d' });
    await vi.advanceTimersByTimeAsync(feedStore.FEED_REFRESH_DELAY_MS + 50);
    library.useLibrary.getState().unfollow('1');
    await vi.advanceTimersByTimeAsync(feedStore.FEED_REFRESH_DELAY_MS + 50);
    expect(events.filter((e) => e === 'refreshFeed')).toHaveLength(2);
  });
});

describe('лента при запуске', () => {
  it('сохранённая лента собрана без нынешних подписок (прошлая пересборка сорвалась) — пересобирается сразу', async () => {
    vi.resetModules();
    const { emptyLibrary } = await import('../../shared/library');
    vi.stubGlobal('window', {
      aura: {
        library: {
          load: async () => ({ ...emptyLibrary(), followedArtists: [{ id: '1598190372', name: 'madk1d', followedAt: 1 }] }),
          save: async () => undefined,
        },
        artists: {
          feed: async () => ({ ...EMPTY_FEED, updatedAt: 1, followedIds: [] }),
          refreshFeed: async () => {
            events.push('startup-refresh');
            return { ...EMPTY_FEED, updatedAt: 2, followedIds: ['1598190372'] };
          },
          onFeed: () => () => undefined,
        },
      },
    });
    const lib = await import('./useLibrary');
    const feed = await import('./useFeed');
    await lib.useLibrary.getState().load();
    feed.initFeed();
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toContain('startup-refresh');
    expect(feed.useFeed.getState().followedIds).toEqual(['1598190372']);
  });
});