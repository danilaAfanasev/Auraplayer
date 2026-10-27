// Считает, сколько секунд трек реально звучал, и один раз сообщает, когда набралось 10 («прослушан»).
// Чистая логика без часов и стора: вызывающий передаёт время сам — так её можно проверить тестами.

/** Столько звучания нужно, чтобы трек попал в историю. */
export const LISTEN_THRESHOLD_MS = 10_000;
/**
 * Больше этого между двумя обновлениями плеера не засчитывается: окно могли заморозить,
 * компьютер — уснуть. Плеер обновляется несколько раз в секунду.
 */
export const MAX_TICK_GAP_MS = 2_000;

export interface ListenTracker {
  /** `trackId` — текущий трек (или null), `playing` — звук идёт, `nowMs` — текущее время. */
  update(trackId: string | null, playing: boolean, nowMs: number): void;
}

export function createListenTracker(
  onListened: (trackId: string) => void,
  thresholdMs: number = LISTEN_THRESHOLD_MS,
): ListenTracker {
  let currentId: string | null = null;
  let heardMs = 0;
  let lastTick: number | null = null;
  let reported = false;

  return {
    update(trackId, playing, nowMs) {
      if (trackId !== currentId) {
        currentId = trackId;
        heardMs = 0;
        reported = false;
        lastTick = null;
      }
      if (currentId === null) return;

      // Время между прошлым и этим обновлением считается, только если в прошлый раз трек звучал.
      if (lastTick !== null) heardMs += Math.min(Math.max(0, nowMs - lastTick), MAX_TICK_GAP_MS);
      lastTick = playing ? nowMs : null;

      if (!reported && heardMs >= thresholdMs) {
        reported = true;
        onListened(currentId);
      }
    },
  };
}
