// Подписка на плеер: трек, звучавший 10 секунд, попадает в историю библиотеки.
// Логику плеера не трогает — только слушает его состояние.
import { useLibrary } from '../../stores/useLibrary';
import { selectCurrentTrack, usePlayer } from '../../stores/usePlayer';
import { createListenTracker } from './listenTracker';

let started = false;

/** Подключает историю один раз; вызывается при старте окна. */
export function initHistoryTracking(): void {
  if (started) return;
  started = true;
  const tracker = createListenTracker(() => {
    const track = selectCurrentTrack(usePlayer.getState());
    if (track) useLibrary.getState().pushHistory(track);
  });
  usePlayer.subscribe((s) => {
    tracker.update(selectCurrentTrack(s)?.id ?? null, s.isPlaying, Date.now());
  });
}
