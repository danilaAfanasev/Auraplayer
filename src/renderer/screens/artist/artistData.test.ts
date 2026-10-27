import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_ARTIST_NOT_FOUND } from '../../../shared/api';
import type { ArtistPage } from '../../../shared/types';

let page: (q: { name?: string; id?: string }) => Promise<ArtistPage>;
let data: typeof import('./artistData');
let ui: typeof import('../../stores/useUi');

const PAGE: ArtistPage = { artist: { id: '7', name: 'sqwore' }, topTracks: [], releases: [], similar: [] };

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', { aura: { artists: { page: (q: { name?: string }) => page(q) } } });
  ui = await import('../../stores/useUi');
  data = await import('./artistData');
});

describe('openArtistByName — переход по имени только при точном совпадении', () => {
  it('точного артиста в каталоге нет — открывается поиск по этому имени, а не чужая страница', async () => {
    page = async () => {
      throw new Error(CATALOG_ARTIST_NOT_FOUND);
    };
    expect(await data.openArtistByName('sqwore')).toBe(false);
    expect(ui.useUi.getState().screen).toEqual({ name: 'search' });
    expect(ui.useUi.getState().query).toBe('sqwore');
    expect(ui.useUi.getState().toasts).toEqual([]);
  });

  it('нашёлся — страница артиста по имени', async () => {
    page = async () => PAGE;
    expect(await data.openArtistByName(' sqwore ')).toBe(true);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'name:sqwore' });
  });

  it('нет сети — тост, экран тот же', async () => {
    page = async () => {
      throw new Error('Нет соединения');
    };
    expect(await data.openArtistByName('sqwore')).toBe(false);
    expect(ui.useUi.getState().screen).toEqual({ name: 'home' });
    expect(ui.useUi.getState().toasts.map((t) => t.kind)).toEqual(['error']);
  });
});

describe('openArtistByName — известный id по имени', () => {
  const release = (artist: string): import('../../../shared/types').ArtistRelease => ({
    id: '900',
    title: 'Альбом',
    artist,
    artistId: '55',
    kind: 'album',
    releaseDate: '2026-01-01',
    trackCount: 10,
  });

  it('имя совпадает (без учёта регистра и «ё») с подпиской — страница по её id, без запроса по имени', async () => {
    const calls: unknown[] = [];
    page = async (q) => {
      calls.push(q);
      return PAGE;
    };
    const { useLibrary } = await import('../../stores/useLibrary');
    useLibrary.getState().follow({ id: '42', name: 'Сквор Ё' });
    expect(await data.openArtistByName('сквор е')).toBe(true);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'id:42' });
    expect(calls).toEqual([]);
  });

  it('единственный исполнитель релиза с artistId — страница по этому id', async () => {
    page = async () => PAGE;
    const known = data.releaseArtists(release('madk1d'));
    expect(known).toEqual([{ id: '55', name: 'madk1d' }]);
    expect(await data.openArtistByName('madk1d', known)).toBe(true);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'id:55' });
  });

  it('у релиза несколько исполнителей — id не приписывается никому, переход по имени', async () => {
    page = async () => PAGE;
    expect(data.releaseArtists(release('madk1d & VILLIAN'))).toEqual([]);
    expect(await data.openArtistByName('sqwore', data.releaseArtists(release('madk1d & VILLIAN')))).toBe(true);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'name:sqwore' });
  });

  it('страница по имени подписанного артиста открывается по id подписки (на ней он — подписанный)', async () => {
    expect(data.artistQueryOf({ name: 'SQWORE' }, [{ id: '42', name: 'sqwore' }])).toEqual({ id: '42' });
    expect(data.artistQueryOf({ name: 'другой' }, [{ id: '42', name: 'sqwore' }])).toEqual({ name: 'другой' });
    expect(data.artistQueryOf({ id: '7' }, [{ id: '42', name: 'sqwore' }])).toEqual({ id: '7' });
  });
});

describe('openArtistByName — тёзки: подсказка-трек', () => {
  it('трек уходит в запрос страницы, а параметр экрана хранит его — другой трек того же имени даёт другую страницу', async () => {
    const calls: unknown[] = [];
    page = async (q) => {
      calls.push(q);
      return PAGE;
    };
    expect(await data.openArtistByName('Zoe', [], { title: 'Ночной звонок' })).toBe(true);
    expect(calls).toEqual([{ name: 'Zoe', track: { title: 'Ночной звонок' } }]);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'name:Zoe|track:Ночной звонок' });

    expect(await data.openArtistByName('Zoe', [], { title: 'Другая песня' })).toBe(true);
    expect(calls).toHaveLength(2);
    expect(ui.useUi.getState().screen.param).toBe('name:Zoe|track:Другая песня');
  });

  it('подсказка-трек решает раньше подписки: подписан на одного Zoe — песня другого открывает того, чья песня (история 168)', async () => {
    const calls: unknown[] = [];
    page = async (q) => {
      calls.push(q);
      return { ...PAGE, artist: { id: '77', name: 'Zoe' } };
    };
    const lib = (await import('../../stores/useLibrary')).useLibrary;
    lib.getState().follow({ id: '42', name: 'Zoe' });
    expect(await data.openArtistByName('Zoe', [], { title: 'Ночной звонок' })).toBe(true);
    expect(calls).toEqual([{ name: 'Zoe', track: { title: 'Ночной звонок' } }]);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'name:Zoe|track:Ночной звонок' });
  });

  it('без подсказки подписка по-прежнему решает сразу: страница по id подписки, запроса нет', async () => {
    const calls: unknown[] = [];
    page = async (q) => {
      calls.push(q);
      return PAGE;
    };
    const lib = (await import('../../stores/useLibrary')).useLibrary;
    lib.getState().follow({ id: '42', name: 'Zoe' });
    expect(await data.openArtistByName('Zoe')).toBe(true);
    expect(await data.openArtistByName('Zoe', [], { title: '  ' })).toBe(true);
    expect(calls).toEqual([]);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'id:42' });
  });

  it('экран артиста с подсказкой-треком не подменяет запрос подпиской-тёзкой; без подсказки — подменяет', () => {
    const followed = [{ id: '42', name: 'Zoe' }];
    expect(data.artistQueryOf({ name: 'Zoe', track: { title: 'Ночной звонок' } }, followed)).toEqual({ name: 'Zoe', track: { title: 'Ночной звонок' } });
    expect(data.artistQueryOf({ name: 'Zoe' }, followed)).toEqual({ id: '42' });
  });

  it('известный id исполнителя (единственный артист релиза) точнее песни: страница по нему и с подсказкой', async () => {
    const calls: unknown[] = [];
    page = async (q) => {
      calls.push(q);
      return PAGE;
    };
    expect(await data.openArtistByName('Zoe', [{ id: '55', name: 'Zoe' }], { title: 'Ночной звонок' })).toBe(true);
    expect(calls).toEqual([]);
    expect(ui.useUi.getState().screen).toEqual({ name: 'artist', param: 'id:55' });
  });

  it('без трека запрос прежний: только имя', async () => {
    const calls: unknown[] = [];
    page = async (q) => {
      calls.push(q);
      return PAGE;
    };
    await data.openArtistByName('Zoe');
    expect(calls).toEqual([{ name: 'Zoe' }]);
  });
});

describe('тёзки на странице артиста', () => {
  it('подписанный тёзка в переключателях — первым: страницу другого открыла песня, к своему нужен путь', () => {
    const namesakes = [
      { id: '1', name: 'Zoe', genre: 'Pop' },
      { id: '2', name: 'Zoe' },
    ];
    expect(data.visibleNamesakes(namesakes, [{ id: '2', name: 'Zoe', followedAt: 0 }])).toEqual([{ id: '2', name: 'Zoe' }, { id: '1', name: 'Zoe', genre: 'Pop' }]);
    expect(data.visibleNamesakes(namesakes, [])).toEqual(namesakes);
    expect(data.visibleNamesakes(undefined, [])).toEqual([]);
  });
});
