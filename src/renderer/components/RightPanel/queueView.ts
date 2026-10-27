import type { Track } from '../../../shared/types';

export type QueueRowState = 'played' | 'current' | 'next';

export interface QueueRow {
  track: Track;
  /** Индекс трека в `usePlayer.queue` — по нему `playAt`. */
  index: number;
  state: QueueRowState;
}

export interface QueueViewInput {
  queue: readonly Track[];
  index: number;
  shuffle: boolean;
  order: readonly number[];
  /** `useWave.active?.title` — волна идёт. */
  waveTitle?: string | null;
  /** `usePlayer.queueTitle` — что играет («Мне нравится», плейлист…). */
  queueTitle?: string;
}

export interface QueueView {
  rows: QueueRow[];
  title: string;
  /** Позиция текущего трека в `rows`; -1 — текущего нет. */
  currentPos: number;
}

export const QUEUE_TITLE = 'Очередь';
/** Заголовок блока недавних треков в правой колонке (над очередью). */
export const RECENT_BLOCK_TITLE = 'Недавно';
/** Заголовок очереди, включённой из «Недавно». */
export const RECENT_QUEUE_TITLE = 'Из недавнего';

/** Порядок воспроизведения: при перемешивании — `order` (если он про эту очередь), иначе 0..n-1. */
function playOrder(input: QueueViewInput): readonly number[] {
  const { queue, shuffle, order, index } = input;
  if (shuffle && order.length === queue.length && order.includes(index)) return order;
  return queue.map((_, i) => i);
}

/** Весь список, который играет плеер: с первого трека, в порядке воспроизведения. */
export function queueView(input: QueueViewInput): QueueView {
  const { queue, index } = input;
  const seq = playOrder(input);
  const currentPos = index >= 0 && index < queue.length ? seq.indexOf(index) : -1;
  const rows = seq.map(
    (i, pos): QueueRow => ({
      track: queue[i],
      index: i,
      state: currentPos < 0 || pos > currentPos ? 'next' : pos === currentPos ? 'current' : 'played',
    }),
  );
  const wave = input.waveTitle?.trim();
  const own = input.queueTitle?.trim();
  // Включили из «Недавно» — над очередью уже стоит блок «Недавно»: второй такой же заголовок не нужен.
  const title = own && own.toLowerCase() === RECENT_BLOCK_TITLE.toLowerCase() ? RECENT_QUEUE_TITLE : own;
  return { rows, title: wave ? `Волна: ${wave}` : title || QUEUE_TITLE, currentPos };
}

export interface RowWindow {
  from: number;
  to: number;
}

/** Какая часть окна лежит выше текущей строки (остальное — ниже). */
const SHOWN_ABOVE_SHARE = 1 / 3;

/**
 * Какие строки рисовать: короткий список — все, длинный (500+) — `limit` строк вокруг текущей,
 * остальное открывают кнопками «показать ещё» (`extraAbove`/`extraBelow`).
 */
export function rowWindow(total: number, currentPos: number, limit: number, extraAbove = 0, extraBelow = 0): RowWindow {
  if (total <= limit) return { from: 0, to: total };
  const start = currentPos < 0 ? 0 : Math.round(currentPos - limit * SHOWN_ABOVE_SHARE);
  const from = Math.min(Math.max(0, start), total - limit);
  const to = from + limit;
  return { from: Math.max(0, from - extraAbove), to: Math.min(total, to + extraBelow) };
}
