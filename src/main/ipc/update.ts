// Обновление Aura (G46–G49): IPC над src/main/updater.ts. Ход скачивания уходит во все окна по каналу
// IPC.update.progress. Установка: отдельный скрытый процесс ждёт, пока Aura выйдет (с сохранением),
// запускает установщик тихо поверх, дожидается его и открывает Aura заново.
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { UpdateCheck } from '../../shared/version';
import { IPC } from '../../shared/ipc';
import { fetchToFile } from '../sources/fetchFile';
import { fetchJson } from '../sources/http';
import { createUpdater, installScript, launcherCommand, UpdateError, type Updater } from '../updater';
import { handle, UserError } from './handle';

/** Запуск обёртки не дольше этого (PowerShell стартует за доли секунды; завис — установку не начинаем). */
const LAUNCH_TIMEOUT_MS = 20_000;

const updateDir = (): string => join(app.getPath('temp'), 'aura-update');

/**
 * Пишет скрипт обёртки рядом с установщиком и запускает его отдельным скрытым процессом PowerShell (через
 * `launcherCommand` — так он переживает выход Aura). Промис — когда процесс обёртки запущен.
 */
async function launchInstaller(installer: string, args: string[]): Promise<void> {
  const scriptPath = join(updateDir(), 'update.ps1');
  const script = installScript({
    pid: process.pid,
    installer,
    args,
    relaunch: process.execPath,
    // Упакованная Aura открывается без ключей; не упакованная (проверки) — с теми же, что сейчас (`.`, профиль).
    relaunchArgs: app.isPackaged ? [] : process.argv.slice(1),
  });
  // BOM: Windows PowerShell 5.1 читает .ps1 без него в кодировке ANSI — кириллица в путях сломалась бы.
  await writeFile(scriptPath, '\ufeff' + script, 'utf8');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', launcherCommand(scriptPath)], {
      stdio: 'ignore',
      windowsHide: true,
      // У новой Aura не должно быть ELECTRON_RUN_AS_NODE (иначе Electron запустится как Node).
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('launcher timeout'));
    }, LAUNCH_TIMEOUT_MS);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`launcher exit ${code}`));
    });
  });
}

function broadcastProgress(fraction: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.update.progress, fraction);
  }
}

let updater: Updater | null = null;

function getUpdater(): Updater {
  updater ??= createUpdater({
    fetchJson,
    fetchToFile,
    spawn: launchInstaller,
    quit: () => app.quit(),
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    tempDir: updateDir(),
    // AURA_UPDATE_URL — только для проверок не упакованной Aura; в упакованной не действует (updater тоже его не берёт).
    releaseUrl: app.isPackaged ? undefined : process.env.AURA_UPDATE_URL?.trim() || undefined,
    installDir: app.isPackaged ? dirname(process.execPath) : undefined,
  });
  return updater;
}

const toUserError = (err: unknown): UserError =>
  err instanceof UpdateError ? new UserError(err.message, err.code) : new UserError('Не удалось обновить Aura');

export function registerUpdateIpc(): void {
  handle(IPC.update.version, (): string => app.getVersion());
  handle(IPC.update.check, (manual: unknown): Promise<UpdateCheck> => getUpdater().check(manual === true));
  handle(IPC.update.download, async (): Promise<void> => {
    try {
      await getUpdater().download(broadcastProgress);
    } catch (err) {
      throw toUserError(err);
    }
  });
  handle(IPC.update.cancel, (): void => getUpdater().cancel());
  handle(IPC.update.install, async (): Promise<void> => {
    try {
      await getUpdater().install();
    } catch (err) {
      throw toUserError(err);
    }
  });
}
