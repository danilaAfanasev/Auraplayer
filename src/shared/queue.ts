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
