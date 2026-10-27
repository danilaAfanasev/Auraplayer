// yt-dlp: статус, фоновая установка при запуске, обновление и прогресс (`src/main/ytdlp.ts`).
// Бинарник живёт в userData/bin (не внутри asar); JS-рантайм для YouTube — сам Electron как Node.
// Прогресс отправляется во все окна по каналу IPC.ytdlp.progress ({ stage, progress }).
import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { YtDlpProgress, YtDlpStatus } from '../../shared/api';
import { IPC } from '../../shared/ipc';
import { getSettings } from '../settingsStore';
import { configureYtDlp, ensureYtDlp, needsYtDlp, updateYtDlp, ytDlpPath, ytDlpVersion, YtDlpError } from '../ytdlp';
import { handle, UserError } from './handle';

const INSTALL_FAILED_MESSAGE = 'Не удалось скачать компоненты — проверь интернет и нажми «Повторить»';

/** Состояние установки (не обновления) для окна, которое открылось позже события. */
let installPhase: 'running' | 'failed' | null = null;

function broadcastProgress(p: YtDlpProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.ytdlp.progress, p);
  }
}

/** Прогресс установки, запущенной где угодно (при запуске, «Повторить», первый запрос звука). */
function reportInstall(p: YtDlpProgress): void {
  if (p.stage === 'install') installPhase = 'running';
  else if (p.stage === 'error' && installPhase === 'running') installPhase = 'failed';
  else if (p.stage === 'done') installPhase = null;
  broadcastProgress(p);
}

export function registerYtDlpIpc(): void {
  const userData = app.getPath('userData');
  configureYtDlp({
    binDir: join(userData, 'bin'),
    cacheDir: join(userData, 'ytdlp-cache'),
    jsRuntimePath: process.execPath,
    onProgress: reportInstall,
  });

  handle(IPC.ytdlp.status, async (): Promise<YtDlpStatus> => {
    if (!existsSync(ytDlpPath())) return { installed: false, version: null, ...(installPhase ? { install: installPhase } : {}) };
    return { installed: true, version: await ytDlpVersion().catch(() => null) };
  });

  handle(IPC.ytdlp.install, async (): Promise<void> => {
    try {
      await ensureYtDlp();
      installPhase = null;
      broadcastProgress({ stage: 'done', progress: 1 });
    } catch (err) {
      installPhase = 'failed';
      broadcastProgress({ stage: 'error', progress: 0 });
      throw new UserError(err instanceof YtDlpError && err.kind !== 'install' ? err.message : INSTALL_FAILED_MESSAGE);
    }
  });

  handle(IPC.ytdlp.update, async (): Promise<{ version: string }> => {
    try {
      const { version } = await updateYtDlp(broadcastProgress);
      return { version };
    } catch (err) {
      broadcastProgress({ stage: 'error', progress: 0 });
      throw new UserError(err instanceof YtDlpError ? err.message : 'Не удалось обновить yt-dlp — попробуй позже');
    }
  });
}

/**
 * Готовит yt-dlp в фоне сразу после открытия окна (G37): если включён YouTube или SoundCloud и его ещё нет.
 * Окно не ждёт; без сети ошибка уходит в прогресс (полоска «Повторить»), следующий запуск попробует снова.
 */
export function prepareYtDlpInBackground(): void {
  void (async () => {
    const settings = await getSettings().catch(() => null);
    if (!settings || !needsYtDlp(settings)) return;
    await ensureYtDlp().catch(() => undefined);
  })();
}
