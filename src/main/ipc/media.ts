// Медиаклавиши. Заглушка таска 01: регистрацию клавиш подключает таск плеера.
// Событие отправляется в окно по каналу IPC.media.key ('play-pause' | 'next' | 'prev').
import type { BrowserWindow } from 'electron';

export function registerMediaKeys(_win: BrowserWindow): void {
  // пока ничего: Chromium сам передаёт медиаклавиши в navigator.mediaSession
}
