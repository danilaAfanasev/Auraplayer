import { describe, expect, it } from 'vitest';
import { EMPTY_THUMB_HISTORY, push, redo, undo } from './thumbHistory';

// Рисунки обозначены короткими строками: важен порядок состояний, а не клетки.
describe('история значка', () => {
  it('отмена возвращает рисунок до шага, а не после него', () => {
    const h = push(EMPTY_THUMB_HISTORY, 'A'); // было A, стало B
    const r = undo(h, 'B');
    expect(r?.pixels).toBe('A');
    expect(r?.history).toEqual({ past: [], future: ['B'] });
  });

  it('несколько шагов откатываются по одному, в обратном порядке', () => {
    let h = push(EMPTY_THUMB_HISTORY, 'A'); // A -> B
    h = push(h, 'B'); // B -> C
    const first = undo(h, 'C');
    expect(first?.pixels).toBe('B');
    const second = undo(first!.history, 'B');
    expect(second?.pixels).toBe('A');
    expect(undo(second!.history, 'A')).toBeNull();
  });

  it('повтор возвращает отменённое', () => {
    const h = push(EMPTY_THUMB_HISTORY, 'A');
    const back = undo(h, 'B')!;
    const forward = redo(back.history, 'A');
    expect(forward?.pixels).toBe('B');
    expect(forward?.history).toEqual({ past: ['A'], future: [] });
  });

  it('новый шаг после отмены обрезает «вперёд»', () => {
    let h = push(EMPTY_THUMB_HISTORY, 'A');
    h = push(h, 'B'); // A -> B -> C
    const back = undo(h, 'C')!; // сейчас B
    const next = push(back.history, 'B'); // B -> D
    expect(next.future).toEqual([]);
    expect(redo(next, 'D')).toBeNull();
  });

  it('идти некуда — null', () => {
    expect(undo(EMPTY_THUMB_HISTORY, 'A')).toBeNull();
    expect(redo(EMPTY_THUMB_HISTORY, 'A')).toBeNull();
  });

  it('хранит не больше лимита шагов, теряя самые старые', () => {
    let h = EMPTY_THUMB_HISTORY;
    for (const s of ['A', 'B', 'C', 'D']) h = push(h, s, 3);
    expect(h.past).toEqual(['B', 'C', 'D']);
  });
});
