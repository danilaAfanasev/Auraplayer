import { describe, expect, it } from 'vitest';
import { nextIndex, prevIndex, shuffleOrder, type QueueState } from './queue';

const base: QueueState = { length: 4, index: 0, repeat: 'off', shuffle: false, order: [] };

describe('nextIndex', () => {
  it('по порядку — следующий', () => {
    expect(nextIndex({ ...base, index: 1 })).toBe(2);
  });
  it('конец очереди без повтора — стоп (null)', () => {
    expect(nextIndex({ ...base, index: 3 })).toBeNull();
  });
  it('конец очереди с повтором всего списка — к началу', () => {
    expect(nextIndex({ ...base, index: 3, repeat: 'all' })).toBe(0);
  });
  it('повтор одного трека: по окончании — тот же; кнопкой «Следующий» — дальше', () => {
    expect(nextIndex({ ...base, index: 2, repeat: 'one' })).toBe(2);
    expect(nextIndex({ ...base, index: 2, repeat: 'one' }, true)).toBe(3);
    expect(nextIndex({ ...base, index: 3, repeat: 'one' }, true)).toBe(0);
  });
  it('перемешивание — по order', () => {
    const s: QueueState = { ...base, shuffle: true, order: [2, 0, 3, 1], index: 0 };
    expect(nextIndex(s)).toBe(3);
    expect(nextIndex({ ...s, index: 1 })).toBeNull();
    expect(nextIndex({ ...s, index: 1, repeat: 'all' })).toBe(2);
  });
  it('пустая очередь — null', () => {
    expect(nextIndex({ ...base, length: 0, index: -1 })).toBeNull();
  });
});

describe('prevIndex', () => {
  it('в первые 3 секунды — прошлый трек', () => {
    expect(prevIndex({ ...base, index: 2 }, 1.5)).toBe(1);
  });
  it('позже 3 секунд — начало текущего', () => {
    expect(prevIndex({ ...base, index: 2 }, 3)).toBe(2);
    expect(prevIndex({ ...base, index: 2 }, 95)).toBe(2);
  });
  it('первый трек: без повтора — он же, с повтором — последний', () => {
    expect(prevIndex({ ...base, index: 0 }, 0)).toBe(0);
    expect(prevIndex({ ...base, index: 0, repeat: 'all' }, 0)).toBe(3);
  });
  it('перемешивание — назад по order', () => {
    const s: QueueState = { ...base, shuffle: true, order: [2, 0, 3, 1], index: 3 };
    expect(prevIndex(s, 0)).toBe(0);
    expect(prevIndex({ ...s, index: 2 }, 0)).toBe(2);
    expect(prevIndex({ ...s, index: 2, repeat: 'all' }, 0)).toBe(1);
  });
});

describe('shuffleOrder', () => {
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  it('перестановка всех индексов, текущий — первым', () => {
    const order = shuffleOrder(6, 4, seq([0.1, 0.9, 0.5, 0.3, 0.7]));
    expect(order[0]).toBe(4);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('без текущего — просто перестановка', () => {
    const order = shuffleOrder(5, -1, seq([0.2, 0.6]));
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
  it('rng действительно перемешивает (детерминированно)', () => {
    // rng всегда 0 → Фишер — Йетс меняет каждый элемент с первым из оставшейся части
    expect(shuffleOrder(4, -1, () => 0)).toEqual([1, 2, 3, 0]);
  });
  it('пустая очередь — пустой порядок', () => {
    expect(shuffleOrder(0, 0, Math.random)).toEqual([]);
  });
});
