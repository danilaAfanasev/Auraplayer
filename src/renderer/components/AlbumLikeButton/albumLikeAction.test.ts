import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistRelease } from '../../../shared/types';

const release: ArtistRelease = {
  id: '6820766679',
  title: 'Omertà 2',
  artist: 'Captown & Niman',
  artistId: '1436282869',
  kind: 'album',
  releaseDate: '2026-10-23',
  trackCount: 10,
};

let action: typeof import('./albumLikeAction');
let library: typeof import('../../stores/useLibrary');
let ui: typeof import('../../stores/useUi');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('window', { addEventListener: () => undefined, aura: { library: { load: async () => null, save: async () => undefined } } });
  library = await import('../../stores/useLibrary');
  ui = await import('../../stores/useUi');
  action = await import('./albumLikeAction');
});

const albums = () => library.useLibrary.getState().lib.likedAlbums.map((a) => a.release.id);
const lastToast = () => ui.useUi.getState().toasts.at(-1)!;

describe('сердечко альбома: тост и «Вернуть»', () => {
  it('сохранил — «Альбом сохранён»; «Вернуть» убирает альбом обратно без нового тоста', () => {
    expect(action.toggleAlbumSaved(release)).toBe(true);
    expect(albums()).toEqual([release.id]);
    expect(lastToast()).toMatchObject({ text: 'Альбом сохранён', action: { label: 'Вернуть' } });
    lastToast().action!.run();
    expect(albums()).toEqual([]);
    expect(ui.useUi.getState().toasts).toHaveLength(1);
  });

  it('убрал — «Альбом убран»; «Вернуть» сохраняет снова; «Мне нравится» не тронуто', () => {
    action.toggleAlbumSaved(release);
    expect(action.toggleAlbumSaved(release)).toBe(false);
    expect(lastToast()).toMatchObject({ text: 'Альбом убран', action: { label: 'Вернуть' } });
    lastToast().action!.run();
    expect(albums()).toEqual([release.id]);
    expect(library.useLibrary.getState().lib.likes).toEqual([]);
  });
});
