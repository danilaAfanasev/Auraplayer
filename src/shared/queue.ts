import type { RepeatMode } from './types';

export interface QueueState {
  length: number;
  index: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Порядок проигрывания при перемешивании (перестановка индексов очереди). */
  order: number[];
}

/** Последовательность проигрывания: при перемешивании — `order`, иначе 0..length-1. */
function playSequence(state: QueueState): number[] {
  if (state.shuffle && state.order.length === state.length && state.order.includes(state.index)) {
    return state.order;
  }
  return Array.from({ length: state.length }, (_, i) => i);
}

/**
 * Индекс следующего трека или `null`, если очередь закончилась.
 * `manual` — пользователь нажал «Следующий»: при повторе одного трека всё равно идём дальше
 * (по кругу), а при естественном окончании трека повтор одного возвращает тот же индекс.
 */
export function nextIndex(state: QueueState, manual = false): number | null {
  if (state.length <= 0) return null;
  if (state.repeat === 'one' && !manual && state.index >= 0 && state.index < state.length) return state.index;
  const seq = playSequence(state);
  const pos = seq.indexOf(state.index);
  if (pos >= 0 && pos + 1 < seq.length) return seq[pos + 1];
  return state.repeat === 'off' ? null : seq[0];
}

/**
 * Индекс для кнопки «Предыдущий»: в первые 3 секунды трека — прошлый трек,
 * позже — начало текущего (возвращается текущий индекс).
 */
export function prevIndex(state: QueueState, positionSec: number): number {
  if (state.length <= 0) return state.index;
  if (positionSec >= 3) return state.index;
  const seq = playSequence(state);
  const pos = seq.indexOf(state.index);
  if (pos > 0) return seq[pos - 1];
  if (pos === 0 && state.repeat === 'all') return seq[seq.length - 1];
  return state.index;
}

/** Случайный порядок всех индексов очереди; текущий трек (если есть) — первым. */
export function shuffleOrder(length: number, current: number, rng: () => number = Math.random): number[] {
  const hasCurrent = current >= 0 && current < length;
  const rest: number[] = [];
  for (let i = 0; i < length; i++) if (!hasCurrent || i !== current) rest.push(i);
  // Фишер — Йетс
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return hasCurrent ? [current, ...rest] : rest;
}

export interface QueueEditInput<T> {
  queue: readonly T[];
  index: number;
  order: readonly number[];
  shuffle: boolean;
}

export interface QueueEdit<T> {
  queue: T[];
  index: number;
  order: number[];
}

/**
 * «Играть следующим»: трек встаёт сразу за текущим в порядке проигрывания. Уже есть в будущей части — переезжает
 * (тот же объект, без повтора); играет сейчас или уже следующий — null (менять нечего).
 * `rowIndex` — строка очереди, по которой кликнули (меню в очереди): переезжает именно она, а не первая копия
 * с тем же id; сыгранная строка — ставится копией. Без `rowIndex` (таблицы, «Недавно») — поиск по id.
 * Без перемешивания — вставка в очередь за текущим; с перемешиванием — в конец очереди и в `order` за текущим.
 */
export function insertNext<T extends { id: string }>(s: QueueEditInput<T>, track: T, rowIndex?: number): QueueEdit<T> | null {
  const n = s.queue.length;
  if (s.index < 0 || s.index >= n) return null;
  const shuffled = s.shuffle && s.order.length === n && s.order.includes(s.index);
  const seq = shuffled ? s.order : Array.from({ length: n }, (_, i) => i);
  const pos = seq.indexOf(s.index);
  const row = rowIndex !== undefined && s.queue[rowIndex]?.id === track.id ? rowIndex : undefined;
  let movedAt: number | undefined;
  if (row !== undefined) {
    if (row === s.index) return null;
    const rowPos = seq.indexOf(row);
    if (rowPos === pos + 1) return null;
    if (rowPos > pos) movedAt = row;
  } else {
    if (s.queue[s.index].id === track.id) return null;
    if (pos + 1 < seq.length && s.queue[seq[pos + 1]].id === track.id) return null;
    movedAt = seq.slice(pos + 1).find((i) => s.queue[i].id === track.id);
  }
  const item = movedAt === undefined ? track : s.queue[movedAt];

  if (!shuffled) {
    const queue = s.queue.filter((_, i) => i !== movedAt);
    queue.splice(s.index + 1, 0, item);
    return { queue, index: s.index, order: [] };
  }
  // Перемешано: убранный (переезжающий) элемент сдвигает индексы за ним; трек встаёт в конец очереди.
  const remap = (i: number) => (movedAt !== undefined && i > movedAt ? i - 1 : i);
  const queue = s.queue.filter((_, i) => i !== movedAt);
  queue.push(item);
  const added = queue.length - 1;
  const rest = seq.filter((i) => i !== movedAt).map(remap);
  const at = rest.indexOf(remap(s.index));
  rest.splice(at + 1, 0, added);
  return { queue, index: remap(s.index), order: rest };
}