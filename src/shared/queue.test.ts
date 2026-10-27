import { describe, expect, it } from 'vitest';
import { insertNext, nextIndex, prevIndex, shuffleOrder, type QueueState } from './queue';

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

describe('insertNext («Играть следующим»)', () => {
  const t = (id: string) => ({ id });
  const ids = (q: { id: string }[]) => q.map((x) => x.id).join('');

  it('без перемешивания — сразу за текущим', () => {
    const r = insertNext({ queue: [t('a'), t('b'), t('c')], index: 0, order: [], shuffle: false }, t('x'))!;
    expect(ids(r.queue)).toBe('axbc');
    expect(r.index).toBe(0);
  });

  it('уже в будущей части — переезжает тем же объектом, без повтора', () => {
    const c = t('c');
    const r = insertNext({ queue: [t('a'), t('b'), c, t('d')], index: 0, order: [], shuffle: false }, t('c'))!;
    expect(ids(r.queue)).toBe('acbd');
    expect(r.queue[1]).toBe(c);
  });

  it('уже сыгранный — ставится ещё раз; текущий или уже следующий — ничего не меняется', () => {
    const r = insertNext({ queue: [t('a'), t('b'), t('c')], index: 1, order: [], shuffle: false }, t('a'))!;
    expect(ids(r.queue)).toBe('abac');
    expect(r.index).toBe(1);
    expect(insertNext({ queue: [t('a'), t('b')], index: 0, order: [], shuffle: false }, t('a'))).toBeNull();
    expect(insertNext({ queue: [t('a'), t('b')], index: 0, order: [], shuffle: false }, t('b'))).toBeNull();
  });

  it('с перемешиванием — следующим по порядку проигрывания', () => {
    const queue = [t('a'), t('b'), t('c'), t('d')];
    const r = insertNext({ queue, index: 2, order: [2, 0, 3, 1], shuffle: true }, t('x'))!;
    const play = r.order.map((i) => r.queue[i].id).join('');
    expect(play).toBe('cxadb');
    expect(r.queue[r.index].id).toBe('c');
    expect(nextIndex({ length: r.queue.length, index: r.index, repeat: 'off', shuffle: true, order: r.order })).toBe(r.order[1]);
  });

  it('две копии трека в очереди — переезжает та строка, по которой кликнули (по индексу), а не первая', () => {
    const c1 = t('c');
    const c2 = t('c');
    const queue = [t('a'), t('b'), c1, t('d'), c2, t('e')];
    const r = insertNext({ queue, index: 0, order: [], shuffle: false }, c2, 4)!;
    expect(ids(r.queue)).toBe('acbcde');
    expect(r.queue[1]).toBe(c2);
    expect(r.queue[3]).toBe(c1);
    // Строка уже следующая — менять нечего; сыгранная копия — ставится ещё раз.
    expect(insertNext({ queue: [t('a'), c1, c2], index: 0, order: [], shuffle: false }, c1, 1)).toBeNull();
    const played = insertNext({ queue: [c1, t('b'), t('x'), c2], index: 1, order: [], shuffle: false }, c1, 0)!;
    expect(ids(played.queue)).toBe('cbcxc');
  });

  it('с перемешиванием — переезд будущего трека', () => {
    const queue = [t('a'), t('b'), t('c'), t('d')];
    const r = insertNext({ queue, index: 2, order: [2, 0, 3, 1], shuffle: true }, t('b'))!;
    expect(r.order.map((i) => r.queue[i].id).join('')).toBe('cbad');
    expect(r.queue).toHaveLength(4);
    expect(r.queue[r.index].id).toBe('c');
  });
});