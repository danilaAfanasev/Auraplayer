import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '../../shared/api';
import { IPC } from '../../shared/ipc';
import type { Track } from '../../shared/types';

// Поддельный electron и источники: скачанная копия ищется по id трека, адаптера Jamendo нет.
const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  downloaded: new Map<string, string>(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\data' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => fake.handlers.set(channel, fn),
    removeHandler: (channel: string) => fake.handlers.delete(channel),
  },
}));
vi.mock('../settingsStore', () => ({ getSettings: async () => ({}) }));
vi.mock('../sources', () => ({
  querySource: async () => ({ source: 'archive', tracks: [] }),
  resolveStream: async (track: Track) => {
    const file = fake.downloaded.get(track.id);
    if (file) return `aura-media://file/${encodeURIComponent(file)}`;
    if (track.source === 'archive') return 'https://archive.org/stream';
    throw new Error('Неизвестный источник');
  },
  // Подготовка заранее здесь не проверяется (см. sources/index.test.ts): запрос идёт сразу в resolveStream.
  createStreamPreparer: (resolve: (track: Track, opts: object) => Promise<string>) => ({
    prepare: () => undefined,
    resolve: (track: Track, opts?: object) => resolve(track, opts ?? {}),
  }),
}));

const { registerSourcesIpc } = await import('./sources');

async function resolve(track: unknown): Promise<IpcResult<string>> {
  return (await fake.handlers.get(IPC.sources.resolveStream)!({}, track)) as IpcResult<string>;
}

const jamendo = { id: 'jamendo:123', source: 'jamendo', sourceId: '123', title: 'Песня', artist: 'Исполнитель', downloadable: true };

beforeEach(() => {
  fake.handlers.clear();
  fake.downloaded.clear();
  registerSourcesIpc();
});

describe('resolveStream: трек источника, которого больше нет (Jamendo)', () => {
  it('скачанный файл на месте — играет из файла', async () => {
    fake.downloaded.set('jamendo:123', 'D:\\Музыка\\Исполнитель — Песня.mp3');
    expect(await resolve(jamendo)).toEqual({ ok: true, value: `aura-media://file/${encodeURIComponent('D:\\Музыка\\Исполнитель — Песня.mp3')}` });
  });

  it('файла нет — понятная ошибка, а не «Неизвестный источник»', async () => {
    const r = await resolve(jamendo);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toBe('Этот источник больше не поддерживается — трек играет, только если он скачан');
  });

  it('трек из library.json (источник уже «Файл», id прежний): файл есть — играет, нет — та же понятная ошибка', async () => {
    const fromLibrary = { ...jamendo, source: 'local', downloadable: false };
    expect(await resolve(fromLibrary)).toMatchObject({ ok: false, error: { message: 'Этот источник больше не поддерживается — трек играет, только если он скачан' } });
    fake.downloaded.set('jamendo:123', 'D:\Музыка\a.mp3');
    expect(await resolve(fromLibrary)).toEqual({ ok: true, value: `aura-media://file/${encodeURIComponent('D:\Музыка\a.mp3')}` });
  });

  it('трек без id или с чужим источником-не-строкой — «Неверный трек»', async () => {
    expect(await resolve({ ...jamendo, source: 42 })).toMatchObject({ ok: false, error: { message: 'Неверный трек' } });
    expect(await resolve({ source: 'archive' })).toMatchObject({ ok: false, error: { message: 'Неверный трек' } });
  });

  it('обычный трек — как раньше', async () => {
    expect(await resolve({ ...jamendo, id: 'archive:x/y.mp3', source: 'archive', sourceId: 'x/y.mp3' })).toEqual({ ok: true, value: 'https://archive.org/stream' });
  });
});
