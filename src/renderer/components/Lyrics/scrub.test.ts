import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, isDragDistance, isScrubbing, scrollTopFor, scrubStart, scrubStep, targetLine, WHEEL_IDLE_MS, type ScrubEvent, type ScrubState } from './scrub';

/** Прогоняет события и собирает, сколько раз просили перемотать. */
function run(events: ScrubEvent[], from: ScrubState = scrubStart): { state: ScrubState; commits: number } {
  let state = from;
  let commits = 0;
  for (const e of events) {
    const r = scrubStep(state, e);
    state = r.state;
    if (r.commit) commits++;
  }
  return { state, commits };
}

describe('isDragDistance', () => {
  it('сдвиг меньше порога — это ещё клик', () => {
    expect(isDragDistance(2, 2)).toBe(false);
    expect(isDragDistance(0, DRAG_THRESHOLD_PX - 1)).toBe(false);
  });
  it('сдвиг от порога и дальше — перетаскивание, в любую сторону', () => {
    expect(isDragDistance(0, DRAG_THRESHOLD_PX)).toBe(true);
    expect(isDragDistance(-DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(isDragDistance(4, 4)).toBe(true);
  });
});

describe('targetLine', () => {
  const centers = [100, 160, 220, 280];
  it('берёт строку, чей центр ближе всего к отметке', () => {
    expect(targetLine(centers, 100)).toBe(0);
    expect(targetLine(centers, 185)).toBe(1);
    expect(targetLine(centers, 191)).toBe(2);
    expect(targetLine(centers, 9999)).toBe(3);
    expect(targetLine(centers, -50)).toBe(0);
  });
  it('пропускает пустые строки-паузы', () => {
    expect(targetLine(centers, 160, [false, true, false, false])).toBe(0);
    expect(targetLine(centers, 230, [false, false, true, false])).toBe(3);
  });
  it('нет строк — -1', () => {
    expect(targetLine([], 10)).toBe(-1);
    expect(targetLine([10, 20], 10, [true, true])).toBe(-1);
  });
});

describe('scrollTopFor', () => {
  it('ставит центр строки на середину окна текста', () => {
    expect(scrollTopFor(500, 400)).toBe(300);
  });
  it('не уходит выше начала', () => {
    expect(scrollTopFor(100, 400)).toBe(0);
  });
});

describe('scrubStep: перетаскивание', () => {
  it('отпустили, не сдвинувшись, — это клик: перемотки текстом нет', () => {
    const r = run([{ type: 'down', x: 10, y: 10 }, { type: 'move', x: 12, y: 11 }, { type: 'up' }]);
    expect(r.commits).toBe(0);
    expect(r.state.phase).toBe('idle');
  });
  it('мотаем: за порогом — перетаскивание, перемотка одна, на отпускании', () => {
    const down = run([{ type: 'down', x: 10, y: 10 }]);
    expect(isScrubbing(down.state)).toBe(false);
    const moved = run([{ type: 'move', x: 10, y: 30 }], down.state);
    expect(isScrubbing(moved.state)).toBe(true);
    const many = run(
      [
        { type: 'move', x: 10, y: 60 },
        { type: 'move', x: 10, y: 90 },
        { type: 'move', x: 10, y: 120 },
      ],
      moved.state,
    );
    expect(many.commits).toBe(0);
    const up = run([{ type: 'up' }], many.state);
    expect(up.commits).toBe(1);
    expect(isScrubbing(up.state)).toBe(false);
  });
  it('отмена указателя во время перетаскивания — без перемотки', () => {
    const r = run([{ type: 'down', x: 0, y: 0 }, { type: 'move', x: 0, y: 40 }, { type: 'cancel' }]);
    expect(r.commits).toBe(0);
    expect(r.state.phase).toBe('idle');
  });
  it('возврат к точке нажатия не отменяет перетаскивание', () => {
    const r = run([{ type: 'down', x: 0, y: 0 }, { type: 'move', x: 0, y: 40 }, { type: 'move', x: 0, y: 1 }, { type: 'up' }]);
    expect(r.commits).toBe(1);
  });
});

describe('scrubStep: колёсико', () => {
  it('пока крутят — мотаем, перемотки нет; через паузу — одна', () => {
    const r = run([
      { type: 'wheel', at: 1000 },
      { type: 'tick', at: 1100 },
      { type: 'wheel', at: 1150 },
      { type: 'tick', at: 1150 + WHEEL_IDLE_MS - 1 },
    ]);
    expect(r.commits).toBe(0);
    expect(isScrubbing(r.state)).toBe(true);
    const done = run([{ type: 'tick', at: 1150 + WHEEL_IDLE_MS }, { type: 'tick', at: 5000 }], r.state);
    expect(done.commits).toBe(1);
    expect(isScrubbing(done.state)).toBe(false);
  });
  it('новое прокручивание после паузы — новая перемотка', () => {
    const first = run([{ type: 'wheel', at: 0 }, { type: 'tick', at: WHEEL_IDLE_MS }]);
    const second = run([{ type: 'wheel', at: 2000 }, { type: 'tick', at: 2000 + WHEEL_IDLE_MS }], first.state);
    expect(first.commits + second.commits).toBe(2);
  });
  it('таймер без прокручивания ничего не делает', () => {
    expect(run([{ type: 'tick', at: 99999 }]).commits).toBe(0);
  });
  it('нажатие посреди колёсика отменяет его перемотку: дальше решает клик или перетаскивание', () => {
    const r = run([{ type: 'wheel', at: 0 }, { type: 'down', x: 5, y: 5 }, { type: 'tick', at: 5000 }]);
    expect(r.commits).toBe(0);
    expect(r.state.phase).toBe('pressed');
  });
  it('колёсико во время перетаскивания не ломает его', () => {
    const r = run([{ type: 'down', x: 0, y: 0 }, { type: 'move', x: 0, y: 50 }, { type: 'wheel', at: 10 }, { type: 'tick', at: 9000 }, { type: 'up' }]);
    expect(r.commits).toBe(1);
  });
});
