import { describe, expect, it } from 'vitest';
import type { Track } from '../../../shared/types';
import { queueView, rowWindow } from './queueView';

const t = (n: number): Track => ({
  id: `catalog:${n}`,
  source: 'catalog',
  sourceId: String(n),
  title: `Трек ${n}`,
  artist: 'Артист',
  downloadable: false,
});
const tracks = (n: number) => Array.from({ length: n }, (_, i) => t(i));

describe('queueView', () => {
  it('без перемешивания: весь список с первого трека, сыгранные / текущий / будущие', () => {
    const v = queueView({ queue: tracks(5), index: 2, shuffle: false, order: [] });
    expect(v.rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(v.rows.map((r) => r.state)).toEqual(['played', 'played', 'current', 'next', 'next']);
    expect(v.currentPos).toBe(2);
  });

  it('с перемешиванием: порядок воспроизведения, «сыгранные» — левее текущего в order', () => {
    const v = queueView({ queue: tracks(5), index: 3, shuffle: true, order: [4, 3, 0, 2, 1] });
    expect(v.rows.map((r) => [r.index, r.state])).toEqual([
      [4, 'played'],
      [3, 'current'],
      [0, 'next'],
      [2, 'next'],
      [1, 'next'],
    ]);
    expect(v.currentPos).toBe(1);
  });

  it('перемешивание включено, но order не соответствует очереди (дописали) — обычный порядок', () => {
    const v = queueView({ queue: tracks(4), index: 1, shuffle: true, order: [1, 0] });
    expect(v.rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });

  it('нет текущего (индекс -1) — все будущие', () => {
    const v = queueView({ queue: tracks(2), index: -1, shuffle: false, order: [] });
    expect(v.rows.map((r) => r.state)).toEqual(['next', 'next']);
    expect(v.currentPos).toBe(-1);
  });

  it('пустая очередь — нет строк', () => {
    const v = queueView({ queue: [], index: -1, shuffle: false, order: [] });
    expect(v.rows).toEqual([]);
    expect(v.currentPos).toBe(-1);
  });

  it('заголовок: волна важнее названия списка, иначе «Очередь»', () => {
    const base = { queue: tracks(1), index: 0, shuffle: false, order: [] };
    expect(queueView({ ...base, waveTitle: 'Моя волна', queueTitle: 'Поиск' }).title).toBe('Волна: Моя волна');
    expect(queueView({ ...base, waveTitle: null, queueTitle: 'Мне нравится' }).title).toBe('Мне нравится');
    expect(queueView({ ...base, waveTitle: null, queueTitle: '  ' }).title).toBe('Очередь');
    expect(queueView(base).title).toBe('Очередь');
  });
});

describe('rowWindow', () => {
  it('короткий список показывается целиком', () => {
    expect(rowWindow(80, 40, 120)).toEqual({ from: 0, to: 80 });
  });

  it('длинный список — окно вокруг текущего, текущий внутри', () => {
    const w = rowWindow(600, 300, 120);
    expect(w.to - w.from).toBe(120);
    expect(w.from).toBeLessThanOrEqual(300);
    expect(w.to).toBeGreaterThan(300);
  });

  it('у начала окно прижато к нулю, у конца — к длине', () => {
    expect(rowWindow(600, 3, 120)).toEqual({ from: 0, to: 120 });
    expect(rowWindow(600, 598, 120)).toEqual({ from: 480, to: 600 });
  });

  it('«показать ещё» расширяет окно вверх и вниз', () => {
    const base = rowWindow(600, 300, 120);
    const more = rowWindow(600, 300, 120, 100, 50);
    expect(more.from).toBe(base.from - 100);
    expect(more.to).toBe(base.to + 50);
  });

  it('текущего нет — окно с начала', () => {
    expect(rowWindow(600, -1, 120)).toEqual({ from: 0, to: 120 });
  });
});

describe('заголовок очереди из «Недавно»', () => {
  it('включили из «Недавно» — у очереди «Из недавнего», а не второй «Недавно»', () => {
    const queue = [t(1), t(2)];
    expect(queueView({ queue, index: 0, shuffle: false, order: [], queueTitle: 'Недавно' }).title).toBe('Из недавнего');
    expect(queueView({ queue, index: 0, shuffle: false, order: [], queueTitle: 'Мне нравится' }).title).toBe('Мне нравится');
  });
});