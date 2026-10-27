// Перемотка текстом: чистая логика без DOM. Что считать кликом, а что перетаскиванием, какая строка сейчас
// у центральной отметки и когда трек перематывается (один раз — на отпускании).
export const DRAG_THRESHOLD_PX = 5;
export const WHEEL_IDLE_MS = 400;

export type ScrubPhase = 'idle' | 'pressed' | 'dragging' | 'wheeling';

export interface ScrubState {
  phase: ScrubPhase;
  startX: number;
  startY: number;
  lastWheelAt: number;
}

export type ScrubEvent =
  | { type: 'down'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'up' }
  | { type: 'cancel' }
  | { type: 'wheel'; at: number }
  | { type: 'tick'; at: number };

export interface ScrubResult {
  state: ScrubState;
  commit: boolean;
}

export const scrubStart: ScrubState = { phase: 'idle', startX: 0, startY: 0, lastWheelAt: 0 };

/** Сдвиг от точки нажатия на пороге и дальше — это перетаскивание, а не клик. */
export function isDragDistance(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/** Текст сейчас мотают (перетаскиванием или колёсиком): автопрокрутка стоит, у отметки — строка-цель. */
export const isScrubbing = (state: ScrubState): boolean => state.phase === 'dragging' || state.phase === 'wheeling';

/**
 * Строка у центральной отметки: чей центр ближе всего к `y` (оба — в координатах содержимого).
 * `skip[i]` — строка не цель (пустая пауза). Нет подходящих строк — -1.
 */
export function targetLine(centers: readonly number[], y: number, skip?: readonly boolean[]): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < centers.length; i++) {
    if (skip?.[i]) continue;
    const distance = Math.abs(centers[i] - y);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** Прокрутка, при которой центр строки встаёт на середину окна текста. */
export function scrollTopFor(center: number, viewportHeight: number): number {
  return Math.max(0, center - viewportHeight / 2);
}

/**
 * Автомат жестов над текстом. Перемотка трека (`commit`) — ровно одна на жест: перетаскивание — на отпускании,
 * колёсико — когда оно молчит `WHEEL_IDLE_MS` (событие `tick` шлёт таймер). Нажатие без сдвига — клик по строке:
 * тут перемотки нет, её делает сама строка. Отмена указателя перемотку отменяет.
 */
export function scrubStep(state: ScrubState, event: ScrubEvent): ScrubResult {
  const keep = { state, commit: false };
  switch (event.type) {
    case 'down':
      // Нажатие посреди колёсика бросает его перемотку: дальше решает клик или перетаскивание.
      return { state: { ...state, phase: 'pressed', startX: event.x, startY: event.y }, commit: false };
    case 'move':
      if (state.phase === 'pressed' && isDragDistance(event.x - state.startX, event.y - state.startY)) {
        return { state: { ...state, phase: 'dragging' }, commit: false };
      }
      return keep;
    case 'up':
      if (state.phase === 'dragging') return { state: { ...state, phase: 'idle' }, commit: true };
      if (state.phase === 'pressed') return { state: { ...state, phase: 'idle' }, commit: false };
      return keep;
    case 'cancel':
      return state.phase === 'pressed' || state.phase === 'dragging' ? { state: { ...state, phase: 'idle' }, commit: false } : keep;
    case 'wheel':
      // Во время нажатия колёсико не вмешивается.
      if (state.phase === 'pressed' || state.phase === 'dragging') return keep;
      return { state: { ...state, phase: 'wheeling', lastWheelAt: event.at }, commit: false };
    case 'tick':
      if (state.phase === 'wheeling' && event.at - state.lastWheelAt >= WHEEL_IDLE_MS) {
        return { state: { ...state, phase: 'idle' }, commit: true };
      }
      return keep;
  }
}
