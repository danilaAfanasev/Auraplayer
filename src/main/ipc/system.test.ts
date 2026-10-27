import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '../../shared/api';
import { IPC } from '../../shared/ipc';

// Поддельный electron: обработчики IPC собираются в таблицу, «Показать в папке» записывается.
const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  shown: [] as string[],
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => fake.handlers.set(channel, fn),
    removeHandler: (channel: string) => fake.handlers.delete(channel),
  },
  shell: {
    showItemInFolder: (p: string) => void fake.shown.push(p),
    openExternal: async () => undefined,
  },
}));
vi.mock('./local', () => ({ pickDirectory: async () => null }));
vi.mock('./downloads', () => ({
  showableRoots: async () => ({
    dirs: ['C:\\Users\\u\\Music\\Aura', 'D:\\Моя музыка'],
    files: ['E:\\Старое\\Исполнитель — Песня.mp3'],
  }),
}));

const { registerSystemIpc } = await import('./system');

async function show(path: unknown): Promise<IpcResult<void>> {
  return (await fake.handlers.get(IPC.system.showInFolder)!({}, path)) as IpcResult<void>;
}

beforeEach(() => {
  fake.handlers.clear();
  fake.shown = [];
  registerSystemIpc();
});

describe('showInFolder: только свои папки и файлы', () => {
  it.each([
    'C:\\Users\\u\\Music\\Aura',
    'C:\\Users\\u\\Music\\Aura\\Исполнитель — Песня.mp3',
    'c:\\users\\u\\music\\aura\\вложенная\\трек.flac',
    'D:\\Моя музыка\\альбом\\01.mp3',
    'E:\\Старое\\Исполнитель — Песня.mp3',
  ])('открывает %s', async (path) => {
    expect(await show(path)).toEqual({ ok: true, value: undefined });
    expect(fake.shown).toEqual([path]);
  });

  it.each([
    ['UNC-путь (утечка NTLM через SMB)', '\\\\attacker\\share\\x.mp3'],
    ['UNC через прямые слэши', '//attacker/share/x.mp3'],
    ['путь устройства', '\\\\?\\C:\\Users\\u\\Music\\Aura\\x.mp3'],
    ['поток NTFS', 'C:\\Users\\u\\Music\\Aura\\x.mp3:secret'],
    ['чужая папка', 'C:\\Windows\\System32\\calc.exe'],
    ['соседняя папка с тем же префиксом', 'C:\\Users\\u\\Music\\Aura2\\x.mp3'],
    ['выход через ..', 'C:\\Users\\u\\Music\\Aura\\..\\..\\secret.txt'],
    ['другой файл рядом с файлом записи', 'E:\\Старое\\другое.mp3'],
    ['относительный путь', 'Aura\\x.mp3'],
  ])('отказывает: %s', async (_what, path) => {
    const res = await show(path);
    expect(res.ok).toBe(false);
    expect(fake.shown).toEqual([]);
  });

  it('не строка — отказ', async () => {
    expect((await show(42)).ok).toBe(false);
    expect(fake.shown).toEqual([]);
  });
});
