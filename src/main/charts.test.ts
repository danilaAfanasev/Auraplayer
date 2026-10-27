import { describe, expect, it, vi } from 'vitest';
import type { ArtistFeedSnapshot, ChartsSnapshot } from '../shared/api';
import type { ArtistRelease, Track } from '../shared/types';
import { CHARTS_REFRESH_MS, createChartsService, FEED_RETRIES, FEED_TIMEOUT_MESSAGE } from './charts';
import type { ArtistFeedData } from './sources/artists';
import type { CatalogLists } from './sources/catalog';
import { SourceError } from './sources/types';

const t = (id: string): Track => ({ id: `catalog:${id}`, source: 'catalog', sourceId: id, title: `T${id}`, artist: 'A', downloadable: true });

const cached = {
  version: 1,
  updatedAt: 1_000,
  chart: [t('1'), t('2')],
};

/** charts.json прошлых версий: с «Новинками» и релизами года. */
const legacy = {
  ...cached,
  newReleases: [{ track: t('1'), releaseDate: '2026-10-23' }],
  yearReleases: [{ track: t('3'), releaseDate: '2026-03-10' }],
};

function setup(load: () => Promise<Partial<CatalogLists>>, stored: unknown = cached, now = 5_000) {
  let file: unknown = stored;
  const emitted: ChartsSnapshot[] = [];
  const service = createChartsService({
    load: async () => ({ chart: [], ...(await load()) }),
    read: async () => file,
    write: async (data) => {
      file = data;
    },
    emit: (s) => emitted.push(s),
    now: () => now,
  });
  return { service, emitted, file: () => file };
}

describe('createChartsService — страна чарта', () => {
  it('страна, с которой скачан чарт, сохраняется в charts.json и приходит в снимке', async () => {
    const { service, file } = setup(async () => ({ chart: [t('9')], country: 'de' }));
    const snap = await service.refresh();
    expect(snap.country).toBe('de');
    expect(file()).toMatchObject({ country: 'de' });
    const again = setup(async () => ({ chart: [] }), file());
    expect((await again.service.snapshot()).country).toBe('de');
  });
});

describe('createChartsService', () => {
  it('удачное обновление сохраняет списки в charts.json с меткой времени', async () => {
    const { service, file, emitted } = setup(async () => ({ chart: [t('9')] }));
    const snap = await service.refresh();
    expect(snap).toMatchObject({ updatedAt: 5_000, chart: [{ id: 'catalog:9' }], refreshing: false, error: null });
    expect(file()).toMatchObject({ version: 1, updatedAt: 5_000, chart: [{ id: 'catalog:9' }] });
    expect(emitted.some((s) => s.refreshing)).toBe(true);
  });

  it('без сети — последний сохранённый список и ошибка «Нет соединения»', async () => {
    const { service, file } = setup(async () => {
      throw new SourceError('offline');
    });
    const snap = await service.refresh();
    expect(snap.chart.map((x) => x.id)).toEqual(['catalog:1', 'catalog:2']);
    expect(snap.updatedAt).toBe(1_000);
    expect(snap.error).toEqual({ kind: 'offline', message: 'Нет соединения' });
    expect(file()).toEqual(cached);
  });

  it('повреждённый кэш — пустые списки, без падения', async () => {
    const { service } = setup(async () => {
      throw new SourceError('offline');
    }, { version: 1, chart: 'мусор' });
    const snap = await service.snapshot();
    expect(snap).toMatchObject({ updatedAt: null, chart: [] });
  });

  it('одновременные «Обновить» — один запрос', async () => {
    const load = vi.fn(async () => ({ chart: [] }));
    const { service } = setup(load);
    await Promise.all([service.refresh(), service.refresh()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('обновляет при запуске и каждые 6 часов', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async () => ({ chart: [] }));
      const { service } = setup(load);
      service.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(CHARTS_REFRESH_MS);
      expect(load).toHaveBeenCalledTimes(2);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('кэш прошлых версий с «Новинками»', () => {
  it('читается без ошибок: «Популярное сейчас» на месте, новинок в снимке нет', async () => {
    const { service } = setup(async () => {
      throw new SourceError('offline');
    }, legacy);
    const snap = await service.snapshot();
    expect(snap.chart.map((x) => x.id)).toEqual(['catalog:1', 'catalog:2']);
    expect(snap.updatedAt).toBe(1_000);
    expect(snap).not.toHaveProperty('newReleases');
    expect(snap).not.toHaveProperty('yearReleases');
  });

  it('после обновления в charts.json остаётся только чарт', async () => {
    const { service, file } = setup(async () => ({ chart: [t('9')] }), legacy);
    await service.refresh();
    expect(file()).toEqual({ version: 1, updatedAt: 5_000, chart: [t('9')] });
  });
});

// ---------- Лента артистов: тот же сервис и расписание ----------

const release = (id: string, date: string, extra: Partial<ArtistRelease> = {}): ArtistRelease => ({
  id,
  title: `Релиз ${id}`,
  artist: 'madk1d',
  artistId: '1598190372',
  kind: 'single',
  releaseDate: date,
  trackCount: 1,
  ...extra,
});

const savedFeed = {
  version: 1,
  updatedAt: 2_000,
  followed: [release('1', '2026-10-01')],
  similar: [release('2', '2026-09-20', { artist: 'CUPSIZE', artistId: '111', similarTo: { id: '1598190372', name: 'madk1d' } })],
  followedIds: ['1598190372'],
};

function setupFeed(
  load: (onFollowed: (f: ArtistRelease[]) => void) => Promise<ArtistFeedData>,
  stored: unknown = savedFeed,
  now = 5_000,
  extra: { feedTimeoutMs?: number; feedRetryMs?: number; feedEmit?: (s: ArtistFeedSnapshot) => void } = {},
) {
  let file: unknown = stored;
  const emitted: ArtistFeedSnapshot[] = [];
  const service = createChartsService({
    load: async () => ({ chart: [] }),
    read: async () => cached,
    write: async () => undefined,
    emit: () => undefined,
    now: () => now,
    feedTimeoutMs: extra.feedTimeoutMs,
    feedRetryMs: extra.feedRetryMs,
    feed: {
      load,
      read: async () => file,
      write: async (data) => {
        file = data;
      },
      emit: (s) => {
        emitted.push(s);
        extra.feedEmit?.(s);
      },
    },
  });
  return { service, emitted, file: () => file };
}

describe('лента «Новое от моих артистов»', () => {
  it('без обновления — сохранённая лента из файла', async () => {
    const { service } = setupFeed(async () => {
      throw new Error('не должен вызываться');
    });
    const snap = await service.feedSnapshot();
    expect(snap).toMatchObject({ updatedAt: 2_000, followedIds: ['1598190372'], refreshing: false, error: null });
    expect(snap.followed.map((r) => r.id)).toEqual(['1']);
    expect(snap.similar[0].similarTo).toEqual({ id: '1598190372', name: 'madk1d' });
  });

  it('удачное обновление сохраняется с меткой времени; релизы подписок приходят раньше похожих', async () => {
    const fresh: ArtistFeedData = { followed: [release('5', '2026-10-20')], similar: [release('6', '2026-10-10')], followedIds: ['1598190372', '1427819350'] };
    const { service, file, emitted } = setupFeed(async (onFollowed) => {
      onFollowed(fresh.followed);
      return fresh;
    });
    const snap = await service.refreshFeed();
    expect(snap).toMatchObject({ updatedAt: 5_000, followedIds: ['1598190372', '1427819350'], refreshing: false, error: null });
    expect(file()).toEqual({ version: 1, updatedAt: 5_000, ...fresh });
    const partial = emitted.find((s) => s.refreshing && s.followed[0]?.id === '5');
    expect(partial?.similar.map((r) => r.id)).toEqual(['2']); // похожие пока прежние
  });

  it('без сети — сохранённая лента и «Нет соединения»', async () => {
    const { service, file } = setupFeed(async () => {
      throw new SourceError('offline');
    });
    const snap = await service.refreshFeed();
    expect(snap.followed.map((r) => r.id)).toEqual(['1']);
    expect(snap.error).toEqual({ kind: 'offline', message: 'Нет соединения' });
    expect(file()).toEqual(savedFeed);
  });

  it('повреждённый файл ленты — пустая лента', async () => {
    const { service } = setupFeed(async () => ({ followed: [], similar: [], followedIds: [] }), { version: 1, followed: 'мусор' });
    expect(await service.feedSnapshot()).toMatchObject({ updatedAt: null, followed: [], similar: [], followedIds: [] });
  });

  it('«Обновить» во время обновления (новая подписка) — ещё один проход после текущего', async () => {
    let calls = 0;
    let release1: () => void = () => undefined;
    const { service } = setupFeed(
      () =>
        new Promise((resolve) => {
          calls++;
          if (calls === 1) release1 = () => resolve({ followed: [], similar: [], followedIds: [] });
          else resolve({ followed: [], similar: [], followedIds: ['1'] });
        }),
    );
    const first = service.refreshFeed();
    await Promise.resolve();
    const second = service.refreshFeed();
    await new Promise((r) => setTimeout(r, 0));
    release1();
    await first;
    const snap = await second;
    expect(calls).toBe(2);
    expect(snap.followedIds).toEqual(['1']);
  });

  it('обновляется при запуске и каждые 6 часов вместе с чартом', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async () => ({ followed: [], similar: [], followedIds: [] }));
      const { service } = setupFeed(load);
      service.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(CHARTS_REFRESH_MS);
      expect(load).toHaveBeenCalledTimes(2);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('лента: сбой и зависание сборки не держат следующие пересборки', () => {
  const empty: ArtistFeedData = { followed: [], similar: [], followedIds: [] };

  it('сборка зависла — через срок «Не удалось», следующая пересборка идёт сразу', async () => {
    let calls = 0;
    const { service } = setupFeed(
      () => {
        calls++;
        return calls === 1 ? new Promise<ArtistFeedData>(() => undefined) : Promise.resolve({ ...empty, followedIds: ['1', '2'] });
      },
      savedFeed,
      5_000,
      { feedTimeoutMs: 30 },
    );
    const first = await service.refreshFeed();
    expect(first.refreshing).toBe(false);
    expect(first.error).toMatchObject({ kind: 'unavailable', message: FEED_TIMEOUT_MESSAGE });
    expect(first.followedIds).toEqual(['1598190372']); // сохранённая лента остаётся
    const second = await service.refreshFeed();
    expect(calls).toBe(2);
    expect(second).toMatchObject({ error: null, followedIds: ['1', '2'], refreshing: false });
  });

  it('рассылка снимка бросила посреди сборки — сборка всё равно сохраняется, следующая не ждёт вечно', async () => {
    let throwOnce = true;
    let calls = 0;
    const { service, file } = setupFeed(
      async () => ({ ...empty, followedIds: [String(++calls)] }),
      savedFeed,
      5_000,
      {
        feedEmit: () => {
          if (throwOnce) {
            throwOnce = false;
            throw new Error('Render frame was disposed');
          }
        },
      },
    );
    const first = await service.refreshFeed();
    expect(first.followedIds).toEqual(['1']);
    expect((file() as ArtistFeedData).followedIds).toEqual(['1']);
    expect((await service.refreshFeed()).followedIds).toEqual(['2']);
  });

  it('сбой при запуске — повтор через пару минут, а не через 6 часов', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const load = vi.fn(async () => {
        if (++calls === 1) throw new SourceError('unavailable');
        return { ...empty, followedIds: ['1'] };
      });
      const { service } = setupFeed(load, savedFeed, 5_000, { feedRetryMs: 120_000 });
      service.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(load).toHaveBeenCalledTimes(1);
      expect((await service.feedSnapshot()).error).not.toBeNull();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(load).toHaveBeenCalledTimes(2);
      expect((await service.feedSnapshot())).toMatchObject({ error: null, followedIds: ['1'] });
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('лимит автоповторов — на одну серию: после трёх сбоев «Повторить» начинает новую серию с автоповтором', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async (): Promise<ArtistFeedData> => {
        throw new SourceError('unavailable');
      });
      const { service } = setupFeed(load, savedFeed, 5_000, { feedRetryMs: 1_000 });
      service.start();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(load).toHaveBeenCalledTimes(1 + FEED_RETRIES); // первая сборка и три повтора, дальше — тишина
      await vi.advanceTimersByTimeAsync(10_000);
      expect(load).toHaveBeenCalledTimes(1 + FEED_RETRIES);

      await service.refreshFeed(); // «Повторить» от пользователя (или смена подписок)
      expect(load).toHaveBeenCalledTimes(2 + FEED_RETRIES);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(load).toHaveBeenCalledTimes(3 + FEED_RETRIES); // автоповтор снова работает
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});