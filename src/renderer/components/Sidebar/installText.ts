// Полоска «Готовлю YouTube и SoundCloud…» внизу сайдбара: состояние и текст. Чистые функции — без DOM.
import type { YtDlpProgress, YtDlpStatus } from '../../../shared/api';

export type InstallPhase = { kind: 'idle' } | { kind: 'running'; progress: number } | { kind: 'failed' };

/** «Готовлю YouTube и SoundCloud… 45%»; без процентов, пока размер неизвестен. */
export function installStatusText(progress: number): string {
  const base = 'Готовлю YouTube и SoundCloud…';
  return progress >= 0 ? `${base} ${Math.round(progress * 100)}%` : base;
}

/** Состояние по событию прогресса main: обновление yt-dlp из настроек полоски не касается. */
export function applyInstallEvent(phase: InstallPhase, p: YtDlpProgress): InstallPhase {
  if (p.stage === 'install') return { kind: 'running', progress: p.progress };
  if (p.stage === 'done') return { kind: 'idle' };
  if (p.stage === 'error' && phase.kind === 'running') return { kind: 'failed' };
  return phase;
}

/** Состояние для окна, открывшегося после начала установки (события оно пропустило). */
export function phaseFromStatus(status: YtDlpStatus): InstallPhase {
  if (status.install === 'running') return { kind: 'running', progress: -1 };
  if (status.install === 'failed') return { kind: 'failed' };
  return { kind: 'idle' };
}
