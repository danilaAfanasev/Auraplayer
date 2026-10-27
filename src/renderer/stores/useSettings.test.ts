import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';

let saved: Settings[];
let load: () => Promise<Settings>;
let store: typeof import('./useSettings');
let ui: typeof import('./useUi');
let persist: typeof import('./persist');

beforeEach(async () => {
  vi.resetModules();
  saved = [];
  vi.stubGlobal('document', { documentElement: { style: { setProperty: () => undefined }, dataset: {} } });
  vi.stubGlobal('window', {
    aura: {
      settings: { load: () => load(), save: async (s: Settings) => void saved.push(s) },
    },
  });
  store = await import('./useSettings');
  ui = await import('./useUi');
  persist = await import('./persist');
});

describe('useSettings: сбой чтения settings.json', () => {
  it('после неудачной загрузки изменения не сохраняются (файл не затирается), пользователь видит тост', async () => {
    load = async () => {
      throw new Error('EBUSY: resource busy or locked');
    };
    await store.useSettings.getState().load();
    expect(ui.useUi.getState().toasts.map((t) => t.kind)).toEqual(['error']);
    store.useSettings.getState().update({ volume: 0.3 });
    await persist.flushPendingSaves();
    expect(saved).toEqual([]);
  });

  it('после успешной загрузки — сохраняются как обычно', async () => {
    const { defaultSettings } = await import('../../shared/settings');
    load = async () => ({ ...defaultSettings('C:\\Музыка\\Aura'), localFolders: ['D:\\Музыка'] });
    await store.useSettings.getState().load();
    store.useSettings.getState().update({ volume: 0.3 });
    await persist.flushPendingSaves();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ volume: 0.3, localFolders: ['D:\\Музыка'] });
  });
});
