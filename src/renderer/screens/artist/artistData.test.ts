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
