// Прогресс подготовки YouTube (скачивание/обновление yt-dlp) — из события main `aura:ytdlp:progress`.
import { create } from 'zustand';
import type { YtDlpProgress } from '../../../shared/api';

interface YtDlpProgressState {
  /** null — ничего не скачивается. */
  progress: YtDlpProgress | null;
}

const store = create<YtDlpProgressState>(() => ({ progress: null }));
let subscribed = false;

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  window.aura.ytdlp.onProgress((p) => {
    const active = p.stage !== 'done' && p.stage !== 'error';
    store.setState({ progress: active ? p : null });
  });
}

/** Текущий прогресс загрузки yt-dlp (подписка на события — при первом использовании). */
export function useYtDlpProgress(): YtDlpProgress | null {
  subscribe();
  return store((s) => s.progress);
}

/** «Подготовка YouTube… 45%» / «Обновление yt-dlp… 45%». */
export function ytDlpProgressText(p: YtDlpProgress): string {
  const label = p.stage === 'update' ? 'Обновление yt-dlp…' : 'Подготовка YouTube…';
  return p.progress >= 0 ? `${label} ${Math.round(p.progress * 100)}%` : label;
}
