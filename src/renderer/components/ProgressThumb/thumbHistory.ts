/** История правок рисунка значка: чистые функции без React. Рисунок — строка клеток (`pixels`). */
export interface ThumbHistory {
  /** Состояния до каждого шага, старые первыми. */
  past: string[];
  /** Отменённые состояния; ближайшее к текущему — последнее. */
  future: string[];
}

export const THUMB_HISTORY_LIMIT = 100;

export const EMPTY_THUMB_HISTORY: ThumbHistory = { past: [], future: [] };

/** Новый шаг: `before` — рисунок до него. «Вперёд» обрезается; лишние старые шаги отбрасываются. */
export function push(history: ThumbHistory, before: string, limit = THUMB_HISTORY_LIMIT): ThumbHistory {
  return { past: [...history.past, before].slice(-limit), future: [] };
}

/** Отмена: рисунок до последнего шага. `null` — идти некуда. `current` — рисунок сейчас. */
export function undo(history: ThumbHistory, current: string): { history: ThumbHistory; pixels: string } | null {
  if (history.past.length === 0) return null;
  return {
    pixels: history.past[history.past.length - 1],
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
  };
}

/** Повтор: рисунок после отменённого шага. `null` — идти некуда. */
export function redo(history: ThumbHistory, current: string): { history: ThumbHistory; pixels: string } | null {
  if (history.future.length === 0) return null;
  return {
    pixels: history.future[history.future.length - 1],
    history: { past: [...history.past, current], future: history.future.slice(0, -1) },
  };
}
