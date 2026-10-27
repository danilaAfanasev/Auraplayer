import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Поддельный electron: app — источник событий, quit записывается.
const fake = vi.hoisted(() => ({ app: null as unknown as EventEmitter & { quit: () => void }, quits: 0 }));
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  const app = Object.assign(new Emitter(), {
    quit: () => {
      fake.quits++;
      app.emit('before-quit', { preventDefault: () => undefined });
    },
  });
  fake.app = app;
  return { app, ipcMain: { on: () => undefined, removeListener: () => undefined } };
});

const { registerQuitFlush } = await import('./app');

const quitEvent = () => {
  const event = { prevented: false, preventDefault: () => (event.prevented = true) };
  return event;
};

beforeEach(() => {
  fake.app.removeAllListeners();
  fake.quits = 0;
});

describe('registerQuitFlush: выход посреди загрузки', () => {
  it('перед выходом выполняет подготовку (отмена загрузок) и выходит только после неё', async () => {
    let finish!: () => void;
    const prepare = vi.fn(() => new Promise<void>((r) => (finish = r)));
    registerQuitFlush(prepare);
    const event = quitEvent();
    fake.app.emit('before-quit', event);
    expect(event.prevented).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.quits).toBe(0);
    finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.quits).toBe(1);
  });

  it('ошибка подготовки не мешает выйти', async () => {
    registerQuitFlush(() => Promise.reject(new Error('сбой')));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.app.emit('before-quit', quitEvent());
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.quits).toBe(1);
    err.mockRestore();
  });
});
