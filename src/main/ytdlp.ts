// yt-dlp: установка в userData/bin с официального GitHub, версия, обновление и запуск.
// G01: YouTube только анонимно. runYtDlp всегда добавляет --ignore-config/--no-cookies/--no-cookies-from-browser
// и отвергает любые аргументы входа, куки, netrc и файлов учётных данных — до запуска процесса.
// Модуль не импортирует electron: пути и рантайм задаёт configureYtDlp (src/main/ipc/ytdlp.ts).
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import type { YtDlpProgress } from '../shared/api';
import { fetchToFile } from './sources/fetchFile';

export type SpawnFn = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface YtDlpConfig {
  /** Папка бинарника: `<userData>/bin`. */
  binDir: string;
  /**
   * Node-совместимый JS-рантайм для задач YouTube: сам Electron (process.execPath) с ELECTRON_RUN_AS_NODE=1.
   * Без него yt-dlp работает, но часть форматов YouTube может пропасть.
   */
  jsRuntimePath?: string;
  /** Кэш yt-dlp (плеер YouTube и т.п.) — внутри userData, а не в профиле пользователя. */
  cacheDir?: string;
  /** Подмена запуска процесса (тесты). */
  spawn?: SpawnFn;
  /** Прогресс установки/обновления по умолчанию (рассылка в окна). */
  onProgress?: (p: YtDlpProgress) => void;
}

/** Единственный источник бинарника — официальные релизы yt-dlp на GitHub. */
export const YTDLP_RELEASES_URL = 'https://github.com/yt-dlp/yt-dlp/releases';
/** Редирект на страницу последнего релиза: из него берётся номер версии. */
export const YTDLP_LATEST_RELEASE_URL = `${YTDLP_RELEASES_URL}/latest`;
/**
 * Папочная (onedir) сборка: `yt-dlp.exe` + `_internal/`. Стартует за ~0,3 с против ~0,8 с у однофайловой
 * (той при каждом запуске нужно распаковать себя во временную папку) — каждый трек YouTube на полсекунды быстрее.
 * exe лежит там же, где лежала однофайловая (`userData/bin/yt-dlp.exe`): путь не меняется.
 */
export const YTDLP_ZIP_NAME = 'yt-dlp_win.zip';
const SUMS_NAME = 'SHA2-256SUMS';
const EXE_NAME = 'yt-dlp.exe';
/** Папка библиотек папочной сборки — рядом с exe (так её ищет сам yt-dlp.exe). */
const INTERNAL_DIR = '_internal';
/** Распакованная новая версия до замены рабочей. */
const STAGING_DIR = 'yt-dlp.new';
/** Настоящий yt-dlp.exe папочной сборки — около 7 МБ; меньше 1 МБ — точно не он. */
const MIN_EXE_SIZE = 1024 * 1024;
/** Замена версии ждёт, пока доработают запущенные yt-dlp (их файлы заняты). */
const UPDATE_IDLE_WAIT_MS = 30_000;
/** Переход однофайловой сборки на папочную — в фоне, в момент, когда yt-dlp не работает. */
const MIGRATE_IDLE_WAIT_MS = 10 * 60_000;
const BUSY_MESSAGE = 'yt-dlp сейчас занят — попробуй обновить чуть позже';

/** Адрес файла релиза: конкретной версии или последнего. */
export function releaseAssetUrl(name: string, tag: string | null): string {
  return tag ? `${YTDLP_RELEASES_URL}/download/${encodeURIComponent(tag)}/${name}` : `${YTDLP_RELEASES_URL}/latest/download/${name}`;
}

/**
 * G01: опции входа, куки, netrc, сертификатов, сторонних конфигов и произвольных заголовков (Cookie/Authorization).
 * Сравнение без учёта регистра; сокращения длинных опций (optparse их принимает) тоже отвергаются.
 */
export const FORBIDDEN_YTDLP_OPTIONS: readonly string[] = [
  '--cookies',
  '--cookies-from-browser',
  '--username',
  '--password',
  '--netrc',
  '--netrc-location',
  '--netrc-cmd',
  '--video-password',
  '--ap-mso',
  '--ap-username',
  '--ap-password',
  '--client-certificate',
  '--client-certificate-key',
  '--client-certificate-password',
  '--config-locations',
  '--config-location',
  '--add-headers',
  '--add-header',
];
/** Короткие формы: -u (логин), -p (пароль), -n (netrc). */
const FORBIDDEN_SHORT = /[unp]/;
/** Минимальная длина сокращения, которое считаем попыткой назвать запрещённую опцию: «--co», «--us»… */
const MIN_ABBREV = 4;

/** Безопасные аргументы, которые идут первыми в каждом запуске. */
const ANONYMOUS_ARGS = ['--ignore-config', '--no-cookies', '--no-cookies-from-browser'];

export type YtDlpErrorKind = 'forbidden' | 'install' | 'timeout' | 'failed';

export class YtDlpError extends Error {
  constructor(
    readonly kind: YtDlpErrorKind,
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'YtDlpError';
  }
}

let config: YtDlpConfig | null = null;
let installing: Promise<string> | null = null;
let versionCache: string | null = null;

export function configureYtDlp(next: YtDlpConfig): void {
  config = next;
  installing = null;
  versionCache = null;
  upgrading = null;
  migrationTried = false;
  swept = false;
  generation++;
}

function cfg(): YtDlpConfig {
  if (!config) throw new YtDlpError('install', 'YouTube ещё не готов — перезапусти Aura');
  return config;
}

export function ytDlpPath(): string {
  return join(cfg().binDir, EXE_NAME);
}

/** Первый запрещённый G01 аргумент или null. Значения после `--` (позиционные) не проверяются как опции. */
export function findForbiddenArg(args: readonly string[]): string | null {
  for (const raw of args) {
    if (raw === '--') break;
    if (!raw.startsWith('-')) continue;
    const arg = raw.toLowerCase();
    if (arg.startsWith('--')) {
      const name = arg.split('=')[0];
      const hit = FORBIDDEN_YTDLP_OPTIONS.some((f) => f === name || (name.length >= MIN_ABBREV && f.startsWith(name)));
      if (hit) return raw;
    } else {
      // Кластеры коротких опций (-xu) и слитные значения (-uLOGIN): любой u/p/n среди букв — отказ.
      const letters = arg.slice(1).split(/[^a-z]/)[0];
      if (FORBIDDEN_SHORT.test(letters)) return raw;
    }
  }
  return null;
}

function assertAnonymous(args: readonly string[]): void {
  const bad = findForbiddenArg(args);
  if (bad !== null) {
    throw new YtDlpError('forbidden', `Aura использует YouTube только анонимно: аргумент «${bad.split('=')[0]}» запрещён`);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function removeQuietly(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

/**
 * Удаляет папку целиком; занятые файлы остаются (их уберёт уборка при следующем запуске).
 * Через unlink/rmdir: на Windows с Node 24 `rm -r` молча пропускает пути с не-ASCII символами (профиль пользователя).
 */
async function removeTree(path: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const child = join(path, e.name);
    if (e.isDirectory()) await removeTree(child);
    else await removeQuietly(child);
  }
  await rmdir(path).catch(() => undefined);
}

/** Похоже ли на Windows-exe: заголовок «MZ» и разумный размер. */
function looksLikeExe(data: Buffer): boolean {
  return data.length >= MIN_EXE_SIZE && data.subarray(0, 2).toString('latin1') === 'MZ';
}

export interface ZipEntry {
  /** Путь внутри архива через `/`. */
  name: string;
  data: Buffer;
}

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const zipError = () => new YtDlpError('install', 'GitHub вернул повреждённый архив yt-dlp — попробуй позже');

/** Файлы ZIP-архива (без папок): хранение как есть или deflate, с проверкой размера и CRC. ZIP64 не поддерживается. */
export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === ZIP_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw zipError();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ZIP_CENTRAL) throw zipError();
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const packed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (packed === 0xffffffff || size === 0xffffffff || local + 30 > buf.length || buf.readUInt32LE(local) !== ZIP_LOCAL) throw zipError();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    let data: Buffer;
    try {
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = inflateRawSync(raw);
      else throw zipError();
    } catch {
      throw zipError();
    }
    if (data.length !== size || crc32(data) !== crc) throw zipError();
    out.push({ name, data });
  }
  return out;
}

/** Путь файла архива внутри папки сборки: только `yt-dlp.exe` и `_internal/…`, без выхода наружу. */
function stagedPath(stage: string, name: string): string | null {
  const parts = name.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..' || /[:<>|?*]/.test(s))) return null;
  if (!(name === EXE_NAME || (parts[0] === INTERNAL_DIR && parts.length > 1))) return null;
  return join(stage, ...parts);
}

const noop = (): void => undefined;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- работающие процессы и замена версии ----

/** Сколько yt-dlp запущено сейчас: пока они работают, файлы сборки заняты. */
let running = 0;
/** Идёт замена версии: новые запуски ждут её конца. */
let swapGate: Promise<void> | null = null;
/** Переход на папочную сборку или обновление (одно на все вызовы). */
let upgrading: Promise<unknown> | null = null;
/** Номер настройки: фоновая работа прошлой (`configureYtDlp`) не трогает новую. */
let generation = 0;
/** Переход с однофайловой сборки в этом запуске уже пробовали. */
let migrationTried = false;
let swept = false;

/**
 * Выполнить замену, когда yt-dlp не работает. `block` — сразу закрыть новые запуски и ждать конца текущих
 * (обновление по кнопке); иначе ждать естественной паузы, не мешая проигрыванию (фоновый переход).
 */
async function whenIdle<T>(fn: () => Promise<T>, block: boolean, waitMs: number): Promise<T> {
  while (swapGate) await swapGate;
  const until = Date.now() + waitMs;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  if (block) swapGate = gate;
  try {
    for (;;) {
      if (!block) while (swapGate) await swapGate;
      if (running === 0) break;
      if (Date.now() > until) throw new YtDlpError('install', BUSY_MESSAGE);
      await sleep(100);
    }
    swapGate = gate; // проверка и захват — в одном такте: между ними никто не запустится
    return await fn();
  } finally {
    if (swapGate === gate) swapGate = null;
    release();
  }
}

/** Ставит распакованную сборку на место рабочей; не вышло — рабочая остаётся как была. */
async function swapIn(stage: string): Promise<void> {
  const exe = ytDlpPath();
  const internal = join(cfg().binDir, INTERNAL_DIR);
  const tag = Date.now().toString(36);
  const oldExe = `${exe}.${tag}.old`;
  const oldInternal = `${internal}.${tag}.old`;
  const hadExe = await isFile(exe);
  const hadInternal = await isDir(internal);
  if (hadInternal) await rename(internal, oldInternal);
  try {
    if (hadExe) await rename(exe, oldExe);
    let movedInternal = false;
    try {
      await rename(join(stage, INTERNAL_DIR), internal);
      movedInternal = true;
      await rename(join(stage, EXE_NAME), exe);
    } catch (err) {
      if (movedInternal) await rename(internal, join(stage, INTERNAL_DIR)).catch(noop);
      if (hadExe) await rename(oldExe, exe).catch(noop);
      throw err;
    }
  } catch (err) {
    if (hadInternal) await rename(oldInternal, internal).catch(noop);
    throw err;
  }
  // Работающий exe однофайловой сборки не удалить — его уберёт уборка при следующем запуске.
  await removeQuietly(oldExe);
  await removeTree(oldInternal);
}

/** Остатки прошлых установок и обновлений: временные файлы, распаковка, заменённые версии. */
async function sweepLeftovers(): Promise<void> {
  const binDir = cfg().binDir;
  let names: string[];
  try {
    names = await readdir(binDir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(binDir, name);
    if (name === STAGING_DIR || name.endsWith('.old')) await ((await isDir(path)) ? removeTree(path) : removeQuietly(path));
    else if (name.endsWith('.download')) await removeQuietly(path);
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Aura/0.1 (desktop audio player)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** SHA-256 файла `name` из списка контрольных сумм релиза (`<hex>  <имя>` или `<hex> *<имя>`). */
export function checksumFor(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Скачивает папочную сборку с GitHub (`tag` — версия, null — последняя), сверяет SHA-256 с файлом сумм релиза,
 * распаковывает рядом с рабочей и проверяет запуском. Возвращает папку распаковки и версию.
 */
async function downloadOnedir(onProgress: (p: YtDlpProgress) => void, stage: string, tag: string | null): Promise<{ dir: string; version: string }> {
  const binDir = cfg().binDir;
  await mkdir(binDir, { recursive: true });
  const zipPath = join(binDir, `${YTDLP_ZIP_NAME}.download`);
  const stageDir = join(binDir, STAGING_DIR);
  await removeQuietly(zipPath);
  await removeTree(stageDir);
  onProgress({ stage, progress: 0 });
  let data: Buffer;
  try {
    const [, sums] = await Promise.all([
      fetchToFile(releaseAssetUrl(YTDLP_ZIP_NAME, tag), zipPath, (p) => onProgress({ stage, progress: p }), new AbortController().signal),
      fetchText(releaseAssetUrl(SUMS_NAME, tag)),
    ]);
    data = await readFile(zipPath);
    const expected = checksumFor(sums, YTDLP_ZIP_NAME);
    if (!expected || createHash('sha256').update(data).digest('hex') !== expected) {
      throw new YtDlpError('install', 'Скачанный yt-dlp не совпал с контрольной суммой GitHub — попробуй позже');
    }
  } catch (err) {
    throw err instanceof YtDlpError ? err : new YtDlpError('install', 'Не удалось скачать yt-dlp с GitHub — проверь соединение и попробуй ещё раз');
  } finally {
    await removeQuietly(zipPath);
  }
  try {
    const files = readZip(data);
    const exe = files.find((f) => f.name === EXE_NAME);
    if (!exe || !looksLikeExe(exe.data) || !files.some((f) => f.name.startsWith(`${INTERNAL_DIR}/`))) {
      throw new YtDlpError('install', 'GitHub вернул не yt-dlp — попробуй позже');
    }
    for (const f of files) {
      const path = stagedPath(stageDir, f.name);
      if (!path) continue;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, f.data);
    }
    // Проверяем распакованное до замены: рабочую сборку не трогаем, если новая не запускается.
    const { stdout } = await spawnYtDlp(join(stageDir, EXE_NAME), ['--version'], undefined, { timeoutMs: 60_000 }).catch(() => {
      throw new YtDlpError('install', 'Скачанный yt-dlp не запускается');
    });
    const version = readVersion(stdout);
    if (!version) throw new YtDlpError('install', 'Скачанный yt-dlp не запускается');
    return { dir: stageDir, version };
  } catch (err) {
    await removeTree(stageDir);
    throw err;
  }
}

/** Скачать папочную сборку и поставить её на место рабочей, когда yt-dlp не работает. */
async function installOnedir(
  onProgress: (p: YtDlpProgress) => void,
  stage: string,
  tag: string | null,
  idle: { block: boolean; waitMs: number },
): Promise<string> {
  const gen = generation;
  const { dir, version } = await downloadOnedir(onProgress, stage, tag);
  try {
    if (gen !== generation) throw new YtDlpError('install', BUSY_MESSAGE);
    await whenIdle(() => swapIn(dir), idle.block, idle.waitMs);
  } finally {
    await removeTree(dir);
  }
  versionCache = version;
  return version;
}

/** Однофайловая сборка прошлых версий Aura работает как есть, папочная ставится в фоне — один раз за запуск. */
function scheduleMigration(): void {
  if (migrationTried || upgrading) return;
  migrationTried = true;
  const run = installOnedir(noop, 'install', null, { block: false, waitMs: MIGRATE_IDLE_WAIT_MS });
  upgrading = run;
  void run.then(
    () => {
      if (upgrading === run) upgrading = null;
    },
    () => {
      if (upgrading === run) upgrading = null;
    },
  );
}

/** Есть ли папочная сборка (иначе — однофайловая прошлых версий Aura или ничего). */
async function hasOnedir(): Promise<boolean> {
  return isDir(join(cfg().binDir, INTERNAL_DIR));
}

/** Нужен ли yt-dlp: пока включён YouTube или SoundCloud, его готовят в фоне при запуске программы. */
export function needsYtDlp(settings: { youtubeEnabled: boolean; soundcloudEnabled: boolean }): boolean {
  return settings.youtubeEnabled || settings.soundcloudEnabled;
}

/** Путь к yt-dlp.exe; при первом обращении скачивает его (одна загрузка на все одновременные вызовы). */
export function ensureYtDlp(onProgress?: (p: YtDlpProgress) => void): Promise<string> {
  if (installing) return installing;
  const report = onProgress ?? cfg().onProgress ?? noop;
  const run = (async () => {
    if (!swept) {
      swept = true;
      await sweepLeftovers();
    }
    const target = ytDlpPath();
    if (await isFile(target)) {
      if (!(await hasOnedir())) scheduleMigration();
      return target;
    }
    try {
      if (upgrading) await upgrading.catch(noop);
      if (!(await isFile(target))) await installOnedir(report, 'install', null, { block: true, waitMs: UPDATE_IDLE_WAIT_MS });
    } catch (err) {
      report({ stage: 'error', progress: 0 });
      throw err;
    }
    report({ stage: 'done', progress: 1 });
    return target;
  })();
  installing = run;
  // Неудача не запоминается: следующий вызов попробует снова. Успех — тоже: проверка файла дешёвая.
  void run.then(
    () => {
      if (installing === run) installing = null;
    },
    () => {
      if (installing === run) installing = null;
    },
  );
  return run;
}

function readVersion(stdout: string): string | null {
  const line = stdout.trim().split(/\r?\n/).pop()?.trim() ?? '';
  return line ? line : null;
}

/** Версия установленного yt-dlp или null, если он ещё не скачан. */
export async function ytDlpVersion(): Promise<string | null> {
  if (installing) await installing.catch(() => undefined);
  if (!(await isFile(ytDlpPath()))) {
    versionCache = null;
    return null;
  }
  if (versionCache) return versionCache;
  const { stdout } = await launch(ytDlpPath(), ['--version'], undefined, { timeoutMs: 30_000 });
  versionCache = readVersion(stdout);
  return versionCache;
}

/** Номер последнего релиза из редиректа `releases/latest` → `releases/tag/<версия>`; null — не удалось узнать. */
async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(YTDLP_LATEST_RELEASE_URL, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Aura/0.1 (desktop audio player)' },
    });
    const location = res.headers.get('location') ?? '';
    await res.body?.cancel().catch(() => undefined);
    const m = /\/releases\/tag\/([^/?#]+)$/.exec(location);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Обновление до последнего релиза с GitHub (папочная сборка). `updated: false` — уже последняя.
 * Не установлен — устанавливает (это тоже обновление). Пока скачивается, yt-dlp работает как обычно;
 * на время замены новые запуски ждут, а начатые дорабатывают.
 */
export async function updateYtDlp(onProgress?: (p: YtDlpProgress) => void): Promise<{ version: string; updated: boolean }> {
  const report = onProgress ?? cfg().onProgress ?? noop;
  if (installing) await installing.catch(() => undefined);
  if (upgrading) await upgrading.catch(() => undefined);
  const run = (async () => {
    const current = await ytDlpVersion().catch(() => null);
    const latest = await latestVersion();
    if (current && latest && current === latest && (await hasOnedir())) return { version: current, updated: false };
    const fresh = await installOnedir(report, 'update', latest, { block: true, waitMs: UPDATE_IDLE_WAIT_MS });
    report({ stage: 'done', progress: 1 });
    return { version: fresh, updated: fresh !== current };
  })();
  upgrading = run;
  try {
    return await run;
  } finally {
    if (upgrading === run) upgrading = null;
  }
}

export interface RunOptions {
  /** Процесс не завершился за это время — убиваем, ошибка `timeout`. */
  timeoutMs?: number;
  /** Каждая строка stdout по мере вывода (прогресс скачивания). */
  onLine?: (line: string) => void;
}

/** Завершает процесс вместе с дочерними (onefile-сборка yt-dlp запускает себя ещё раз, а он — JS-рантайм). */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
      return;
    } catch {
      /* ниже — обычный kill */
    }
  }
  child.kill();
}

function lastErrorLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return [...lines].reverse().find((l) => l.startsWith('ERROR:')) ?? lines.at(-1) ?? 'yt-dlp завершился с ошибкой';
}

function spawnYtDlp(
  file: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const c = cfg();
  const spawn = c.spawn ?? (nodeSpawn as SpawnFn);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    if (c.jsRuntimePath) env.ELECTRON_RUN_AS_NODE = '1';
    let child: ChildProcess;
    try {
      child = spawn(file, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      reject(new YtDlpError('failed', 'Не удалось запустить yt-dlp'));
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    let reason: 'abort' | 'timeout' | null = null;

    const stop = (why: 'abort' | 'timeout') => {
      if (reason) return;
      reason = why;
      killTree(child);
    };
    const onAbort = () => stop('abort');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = opts.timeoutMs ? setTimeout(() => stop('timeout'), opts.timeoutMs) : null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (!opts.onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) opts.onLine(line);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', () => finish(() => reject(new YtDlpError('failed', 'Не удалось запустить yt-dlp', stderr))));
    child.on('close', (code: number | null) =>
      finish(() => {
        if (pending && opts.onLine) opts.onLine(pending);
        if (reason === 'abort') reject(new DOMException('Aborted', 'AbortError'));
        else if (reason === 'timeout') reject(new YtDlpError('timeout', 'yt-dlp не ответил вовремя', stderr));
        else if (code === 0) resolve({ stdout, stderr });
        else reject(new YtDlpError('failed', lastErrorLine(stderr), stderr));
      }),
    );
  });
}

/** Запуск с учётом замены версии: пока она идёт — ждём; работающие процессы считаются (их файлы заняты). */
async function launch(
  file: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  opts: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  while (swapGate) await swapGate;
  running++;
  try {
    return await spawnYtDlp(file, args, signal, opts);
  } finally {
    running--;
  }
}

/** Аргументы, которые получает каждый запуск: анонимность, свой кэш, JS-рантайм для YouTube. */
function baseArgs(): string[] {
  const c = cfg();
  const args = [...ANONYMOUS_ARGS, '--socket-timeout', '20'];
  if (c.cacheDir) args.push('--cache-dir', c.cacheDir);
  if (c.jsRuntimePath) args.push('--js-runtimes', `node:${c.jsRuntimePath}`);
  return args;
}

/**
 * Запуск yt-dlp (при необходимости сначала скачивает его). Запрещённые G01 аргументы — отказ до запуска.
 * Отмена через `signal` убивает процесс и отклоняет промис AbortError.
 */
export async function runYtDlp(
  args: readonly string[],
  signal?: AbortSignal,
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  assertAnonymous(args);
  const full = [...baseArgs(), ...args];
  assertAnonymous(full);
  const path = await ensureYtDlp();
  return launch(path, full, signal, opts);
}
