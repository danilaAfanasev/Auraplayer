import { describe, expect, it } from 'vitest';
import { createDebouncedSaver, flushPendingSaves } from './persist';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('flushPendingSaves', () => {
  it('сохраняет отложенное значение сразу, не дожидаясь задержки', async () => {
    const saved: number[] = [];
    const saver = createDebouncedSaver<number>(async (v) => void saved.push(v), () => undefined, 10_000);
    saver.schedule(1);
    saver.schedule(2);
    await flushPendingSaves();
    expect(saved).toEqual([2]);
  });

  it('дожидается сохранения, которое уже идёт (таймер сработал)', async () => {
    let done = false;
    const saver = createDebouncedSaver<number>(
      async () => {
        await sleep(80);
        done = true;
      },
      () => undefined,
      5,
    );
    saver.schedule(1);
    await sleep(20); // таймер сработал, запись в процессе
    await flushPendingSaves();
    expect(done).toBe(true);
  });

  it('ошибка сохранения уходит в onError и не ломает сброс', async () => {
    const errors: unknown[] = [];
    const saver = createDebouncedSaver<number>(async () => {
      throw new Error('диск');
    }, (e) => errors.push(e), 10_000);
    saver.schedule(1);
    await expect(flushPendingSaves()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
