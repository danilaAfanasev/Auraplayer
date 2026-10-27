import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryData, Track } from '../../shared/types';

const track: Track = { id: 'archive:x/a.mp3', source: 'archive', sourceId: 'x/a.mp3', title: 'A', artist: 'B', downloadable: true };

let saved: LibraryData[];
let load: () => Promise<LibraryData>;
let store: typeof import('./useLibrary');
let ui: typeof import('./useUi');
let persist: typeof import('./persist');

beforeEach(async () => {
  vi.resetModules();
  saved = [];
  vi.stubGlobal('window', {
    aura: {
      library: { load: () => load(), save: async (lib: LibraryData) => void saved.push(lib) },
    },
  });
  store = await import('./useLibrary');
  ui = await import('./useUi');
  persist = await import('./persist');
});

describe('useLibrary: сбой чтения library.json', () => {
  it('после неудачной загрузки изменения не сохраняются (файл не затирается), пользователь видит тост', async () => {
    load = async () => {
      throw new Error('EBUSY: resource busy or locked');
    };
    await store.useLibrary.getState().load();
    expect(ui.useUi.getState().toasts.map((t) => t.kind)).toEqual(['error']);
    store.useLibrary.getState().toggleLike(track);
    await persist.flushPendingSaves();
    expect(saved).toEqual([]);
  });

  it('после успешной загрузки — сохраняются как обычно', async () => {
    const { emptyLibrary } = await import('../../shared/library');
    load = async () => emptyLibrary();
    await store.useLibrary.getState().load();
    store.useLibrary.getState().toggleLike(track);
    await persist.flushPendingSaves();
    expect(saved).toHaveLength(1);
    expect(saved[0].likes).toEqual([track.id]);
  });
});
