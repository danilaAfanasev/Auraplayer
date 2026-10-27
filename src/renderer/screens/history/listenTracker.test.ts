import { describe, expect, it } from 'vitest';
import { createListenTracker } from './listenTracker';

/** Тик плеера раз в 500 мс с `from` до `to` мс; возвращает время последнего тика. */
function play(tracker: ReturnType<typeof createListenTracker>, id: string, from: number, to: number): number {
  for (let t = from; t <= to; t += 500) tracker.update(id, true, t);
  return to;
}

describe('createListenTracker (история — после 10 секунд прослушивания)', () => {
  it('сообщает о треке только после 10 секунд непрерывного звучания', () => {
    const heard: string[] = [];
    const tracker = createListenTracker((id) => heard.push(id));
    play(tracker, 'a', 0, 9500);
    expect(heard).toEqual([]);
    tracker.update('a', true, 10_000);
    expect(heard).toEqual(['a']);
  });

  it('пауза время не копит: 6 с, долгая пауза, ещё 3 с — рано, после 4 с докопилось', () => {
    const heard: string[] = [];
    const tracker = createListenTracker((id) => heard.push(id));
    play(tracker, 'a', 0, 6000);
    tracker.update('a', false, 6000);
    tracker.update('a', false, 66_000);
    play(tracker, 'a', 66_000, 69_000);
    expect(heard).toEqual([]);
    play(tracker, 'a', 69_000, 73_000);
    expect(heard).toEqual(['a']);
  });

  it('смена трека обнуляет счёт; второй трек засчитывается сам, один раз', () => {
    const heard: string[] = [];
    const tracker = createListenTracker((id) => heard.push(id));
    play(tracker, 'a', 0, 6000);
    play(tracker, 'b', 6500, 12_000);
    expect(heard).toEqual([]);
    play(tracker, 'b', 12_000, 30_000);
    expect(heard).toEqual(['b']);
  });

  it('длинный разрыв между тиками (сон, заморозка) не засчитывается как прослушивание', () => {
    const heard: string[] = [];
    const tracker = createListenTracker((id) => heard.push(id));
    tracker.update('a', true, 0);
    tracker.update('a', true, 600_000);
    expect(heard).toEqual([]);
  });

  it('ничего не играет — ничего не происходит', () => {
    const heard: string[] = [];
    const tracker = createListenTracker((id) => heard.push(id));
    tracker.update(null, false, 0);
    tracker.update(null, false, 20_000);
    expect(heard).toEqual([]);
  });
});
