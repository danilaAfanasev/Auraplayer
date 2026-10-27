// Обновление Aura по вопросу (G46–G49): проверка последнего релиза GitHub, скачивание установщика
// во временную папку со сверкой размера и SHA-256, запуск установщика NSIS тихо поверх и обычный выход.
// Модуль не импортирует electron: сеть, запуск процесса и выход задаёт src/main/ipc/update.ts.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { LATEST_RELEASE_URL, parseLatestRelease, type UpdateCheck, type UpdateErrorCode, type UpdateInfo } from '../shared/version';
import type { FetchFile } from './sources/fetchFile';
import { classifyFetchError } from './sources/http';

export type { UpdateCheck };

/** Проверка релиза не держит запуск дольше этого. */
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/**
 * Ключи установщика NSIS (electron-builder): `/S` — тихо, без мастера; `--updated` — это обновление: установщик
 * не спрашивает «Aura запущена» и даёт ей секунду выйти самой. Папка — `/D=<папка>` последним ключом (так требует NSIS).
 * Перезапуск после установки делает не установщик (`--force-run`), а обёртка запуска в ipc/update.ts.
 */
export const INSTALLER_ARGS: readonly string[] = ['/S', '--updated'];

const PART_SUFFIX = '.part';

export class UpdateError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateError';
  }
}

const MESSAGES: Record<UpdateErrorCode, string> = {
  offline: 'Не удалось скачать обновление — нет соединения',
  corrupt: 'Не удалось скачать обновление — файл пришёл повреждённым',
  cancelled: 'Скачивание обновления отменено',
  failed: 'Не удалось скачать обновление',
};

const updateError = (code: UpdateErrorCode): UpdateError => new UpdateError(code, MESSAGES[code]);

export interface UpdaterDeps {
  fetchJson(url: string, timeoutMs?: number): Promise<unknown>;
  fetchToFile: FetchFile;
  /**
   * Запустить установщик отдельным процессом, который переживёт выход Aura (и откроет её после установки).
   * Промис — процесс запущен; Aura выходит только после этого.
   */
  spawn(file: string, args: string[]): Promise<void> | void;
  /** Обычный выход Aura (с сохранением библиотеки и настроек). */
  quit(): void;
  currentVersion: string;
  isPackaged: boolean;
  /** Своя временная папка обновлений: всё в ней — установщики Aura, убираются при следующей проверке. */
  tempDir: string;
  /** Подменённый адрес релизов (`AURA_UPDATE_URL`) — только для проверок не упакованной Aura; упакованная его не слушает. */
  releaseUrl?: string;
  /** Папка установленной Aura: ставим поверх в неё же. */
  installDir?: string;
}

export interface Updater {
  check(manual: boolean): Promise<UpdateCheck>;
  /** Скачать найденное обновление; во время скачивания повторный вызов ждёт то же скачивание. */
  download(onProgress: (fraction: number) => void): Promise<void>;
  cancel(): void;
  /** Запустить скачанный и проверенный установщик и выйти из Aura. */
  install(): Promise<void>;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function removeFile(path: string): Promise<void> {
  // Не rmSync: на Windows + Node 24 он молча не удаляет файлы с не-ASCII путями (AGENTS.md).
  await unlink(path).catch(() => undefined);
}

/** Файл совпадает с релизом: размер и (если GitHub отдал) SHA-256. */
async function matches(path: string, info: UpdateInfo): Promise<boolean> {
  const st = await stat(path).catch(() => null);
  if (!st || !st.isFile() || st.size !== info.size) return false;
  return !info.sha256 || (await sha256Of(path)) === info.sha256;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  // Подменённый адрес релизов — только у не упакованной Aura (тесты, проверки); упакованная ходит лишь на GitHub.
  const override = deps.isPackaged ? undefined : deps.releaseUrl;
  const releaseUrl = override ?? LATEST_RELEASE_URL;
  /** Последнее найденное обновление. */
  let latest: UpdateInfo | null = null;
  /** Скачанный и проверенный установщик (для `latest`). */
  let ready: string | null = null;
  let running: Promise<void> | null = null;
  let progressListener: (fraction: number) => void = () => undefined;
  let abort: AbortController | null = null;

  /** Установщики прошлых обновлений и обрывки: к новой проверке они не нужны. */
  async function sweep(): Promise<void> {
    if (running || ready) return;
    const names = await readdir(deps.tempDir).catch(() => [] as string[]);
    await Promise.all(names.map((n) => removeFile(join(deps.tempDir, n))));
  }

  async function check(manual: boolean): Promise<UpdateCheck> {
    if (!deps.isPackaged && !override) return { kind: 'none' };
    await sweep();
    let json: unknown;
    try {
      json = await deps.fetchJson(releaseUrl, UPDATE_CHECK_TIMEOUT_MS);
    } catch (err) {
      // При запуске — молчим и работаем дальше; по кнопке — сказать, что не удалось.
      return manual ? { kind: 'error', offline: classifyFetchError(err).kind === 'offline' } : { kind: 'none' };
    }
    const info = parseLatestRelease(json, deps.currentVersion);
    // С настоящего адреса установщик берём только по https (http — только у подменённого адреса проверок).
    if (!info || (!override && !info.assetUrl.startsWith('https://'))) return { kind: 'none' };
    if (latest?.version !== info.version || latest.assetUrl !== info.assetUrl) ready = null;
    latest = info;
    return { kind: 'available', info };
  }

  async function run(info: UpdateInfo): Promise<void> {
    // Имя файла на диске — из версии (только цифры и точки), а не из ответа сервера; и не за пределами tempDir.
    const dest = join(deps.tempDir, `Aura-Setup-${info.version}.exe`);
    if (dirname(resolve(dest)) !== resolve(deps.tempDir)) throw updateError('failed');
    const part = dest + PART_SUFFIX;
    const controller = new AbortController();
    abort = controller;
    try {
      await mkdir(deps.tempDir, { recursive: true });
      await removeFile(part);
      await removeFile(dest);
      if (controller.signal.aborted) throw updateError('cancelled');
      try {
        await deps.fetchToFile(info.assetUrl, part, (p) => progressListener(p), controller.signal);
      } catch (err) {
        if (controller.signal.aborted) throw updateError('cancelled');
        throw updateError(classifyFetchError(err).kind === 'offline' ? 'offline' : 'failed');
      }
      if (controller.signal.aborted) throw updateError('cancelled');
      if (!(await matches(part, info))) throw updateError('corrupt');
      await rename(part, dest);
      ready = dest;
    } catch (err) {
      await removeFile(part);
      await removeFile(dest);
      throw err instanceof UpdateError ? err : updateError('failed');
    } finally {
      if (abort === controller) abort = null;
    }
  }

  function download(onProgress: (fraction: number) => void): Promise<void> {
    progressListener = onProgress;
    if (running) return running;
    const info = latest;
    if (!info) return Promise.reject(new UpdateError('failed', 'Обновление не найдено — проверь обновления ещё раз'));
    if (ready) {
      onProgress(1);
      return Promise.resolve();
    }
    running = run(info).finally(() => {
      running = null;
    });
    return running;
  }

  function cancel(): void {
    abort?.abort();
  }

  async function install(): Promise<void> {
    const info = latest;
    const file = ready;
    if (!info || !file) throw new UpdateError('failed', 'Обновление ещё не скачано');
    // Между скачиванием и установкой файл могли подменить или удалить — проверяем ещё раз.
    if (!(await matches(file, info))) {
      ready = null;
      await removeFile(file);
      throw updateError('corrupt');
    }
    const args = [...INSTALLER_ARGS];
    if (deps.installDir) args.push(`/D=${deps.installDir}`);
    try {
      await deps.spawn(file, args);
    } catch {
      throw new UpdateError('failed', 'Не удалось запустить установку обновления');
    }
    deps.quit();
  }

  return { check, download, cancel, install };
}

/** Сколько обёртка ждёт выхода Aura, прежде чем запустить установщик (дальше установщик закроет её сам). */
const WAIT_EXIT_SEC = 60;

/** Строка в одинарных кавычках PowerShell: внутри ничего не раскрывается, кавычка удваивается. */
// Одинарной кавычкой PowerShell считает не только U+0027, но и типографские U+2018–U+201B: каждую удваиваем,
// иначе строку можно закрыть такой кавычкой и дописать свою команду.
export const psQuote = (s: string): string => `'${s.replace(/['‘’‚‛]/g, (q) => q + q)}'`;

/**
 * Скрипт обёртки (`.ps1`, запускается через `launcherCommand`): дождаться выхода Aura (`pid`) → установщик с ключами и ожиданием → открыть Aura.
 * Aura открывается и при сбое установщика — тогда старая версия, без обновления, но не «пропала».
 * Ключи установщика — одной строкой: `/D=` NSIS читает без кавычек до конца строки (пробелы в пути можно).
 */
export function installScript(opts: { pid: number; installer: string; args: string[]; relaunch: string; relaunchArgs: string[] }): string {
  // Start-Process в PowerShell 5.1 склеивает список ключей без кавычек — ключи с пробелами берём в кавычки сами.
  const cmdArg = (s: string): string => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '')}"` : s);
  const relaunchArgs = opts.relaunchArgs.length > 0 ? ` -ArgumentList ${psQuote(opts.relaunchArgs.map(cmdArg).join(' '))}` : '';
  return [
    '# Aura: установка обновления — ждёт выхода Aura, ставит новую версию тихо поверх и открывает Aura.',
    `Wait-Process -Id ${opts.pid} -Timeout ${WAIT_EXIT_SEC} -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${psQuote(opts.installer)} -ArgumentList ${psQuote(opts.args.join(' '))} -Wait -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${psQuote(opts.relaunch)}${relaunchArgs}`,
  ].join('\r\n') + '\r\n';
}

/**
 * Команда PowerShell, которая запускает скрипт обёртки отдельным скрытым процессом PowerShell.
 * Обёртку не запускаем из Aura напрямую: процессы-дети Node (libuv) живут в задании Windows и умирают вместе
 * с Aura, а `detached` на проверке не стартовал вовсе. Внук, запущенный через Start-Process, из задания
 * выходит (libuv разрешает «тихий выход» из задания) и переживает выход Aura.
 */
export function launcherCommand(scriptPath: string): string {
  const inner = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`;
  return `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList ${psQuote(inner)}`;
}
