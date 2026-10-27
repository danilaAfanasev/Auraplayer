// Очередь скачивания: не больше двух загрузок одновременно, остальные ждут.
// Файл пишется как `*.part` рядом с итоговым и переименовывается по завершении в
// «Исполнитель — Название.ext» (`safeFileName` + `uniquePath`: ничего не перезаписывается).
// Отмена и ошибка удаляют частичный файл. Записи о скачанном — `downloads.json` в userData.
// `remove` удаляет ровно один файл — тот, что записан в записи загрузки, и никогда не папку.
// Модуль не импортирует electron: настройки, хранилище и отправку событий передаёт `ipc/downloads.ts`.
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { safeFileName, uniquePath } from '../shared/filename';
import { makeTrackId, SOURCE_IDS, type DownloadRecord, type DownloadState, type Track } from '../shared/types';
import { classifyFetchError } from './sources/http';
import { SourceError, type SourceAdapter, type SourceContext } from './sources/types';

export const MAX_CONCURRENT_DOWNLOADS = 2;
export const DOWNLOADS_FILE = 'downloads.json';
const PROGRESS_STEP = 0.01;
/** Сколько выход из приложения ждёт, пока отменённые загрузки уберут за собой. */
export const QUIT_CANCEL_TIMEOUT_MS = 3000;
/**
 * Обрывки загрузок: `*.<8 hex>.part` (имя от очереди) и хвосты yt-dlp от него
 * (`*.part.m4a`, `*.part.m4a.part`, `*.part.m4a.ytdl`, `*.part-Frag3`).
 */
export const LEFTOVER_PART = /\.[0-9a-f]{8}\.part(?:$|[.-])/;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.webm']);

/** Запись загрузки + есть ли файл на диске сейчас (файл могли удалить вручную). */
export type DownloadEntry = DownloadRecord & { missing: boolean };

type DownloadFn = NonNullable<SourceAdapter['download']>;

export interface DownloadDeps {
  context(): Promise<SourceContext>;
  /** Метод скачивания адаптера трека; undefined — источник скачивание не умеет. */
  downloaderFor(track: Track): DownloadFn | undefined;
  readRecords(): Promise<unknown>;
  writeRecords(records: DownloadRecord[]): Promise<void>;
  emit(state: DownloadState): void;
  maxConcurrent?: number;
  now?(): number;
}

export interface DownloadManager {
  /** Ставит трек в очередь. Бросает Error с человеческим текстом, если трек скачать нельзя. */
  start(track: Track): Promise<void>;
  cancel(trackId: string): Promise<void>;
  /** Скачанное, новые сверху. */
  list(): Promise<DownloadEntry[]>;
  /** Удаляет файл записи (после подтверждения в интерфейсе) и саму запись. */
  remove(trackId: string): Promise<void>;
  /** Путь скачанного файла, если он есть на диске. */
  findFile(trackId: string): Promise<string | null>;
  /** Пути файлов всех записей (без проверки диска) — их разрешено отдавать протоколу. */
  recordedFiles(): Promise<string[]>;
  /**
   * Перед выходом: отменяет все загрузки (идущие и ждущие) и ждёт, пока они уберут частичные файлы,
   * но не дольше `timeoutMs`. Новые загрузки после этого не начинаются.
   */
  cancelAll(timeoutMs?: number): Promise<void>;
  /** При старте: удаляет из папки скачивания обрывки прошлых загрузок (`LEFTOVER_PART`), кроме идущих. */
  sweepLeftovers(): Promise<void>;
}

/** Список загрузок не прочитался (файл занят или нет доступа) — сохранять его нельзя, он затрёт записи. */
export class RecordsUnavailableError extends Error {
  constructor(cause: unknown) {
    super('файл со списком скачанного занят или недоступен — попробуй ещё раз');
    this.name = 'RecordsUnavailableError';
    this.cause = cause;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Запись в downloads.json: + размер и время изменения файла на момент скачивания. По ним видно,
 * что файл под этим именем — тот самый скачанный, а не чужой, положенный позже на его место.
 */
type StoredRecord = DownloadRecord & {
  size?: number;
  mtimeMs?: number;
  /** id трека до переноса записи (источник удалён из приложения, например Jamendo): по нему ищут лайки и плейлисты. */
  formerId?: string;
};

/** Пути на Windows сравниваются без учёта регистра. */
const pathKey = (p: string): string => p.toLowerCase();

/** Запись принадлежит треку с этим id — нынешним или прежним (до переноса). */
const isRecordOf = (r: StoredRecord, trackId: string): boolean => r.trackId === trackId || r.formerId === trackId;

/**
 * Трек записи, чьего источника больше нет в приложении (Jamendo), становится файлом на диске:
 * играет из скачанного файла, метка «Файл», удаляется из списка как обычно.
 */
function asFileTrack(track: Track, filePath: string): Track {
  const file: Track = {
    ...track,
    id: makeTrackId('local', filePath),
    source: 'local',
    sourceId: filePath,
    downloadable: false,
  };
  delete file.pageUrl; // страница источника, которого больше нет
  return file;
}

function normalizeRecords(raw: unknown): StoredRecord[] {
  const list = isObject(raw) && Array.isArray(raw.records) ? raw.records : Array.isArray(raw) ? raw : [];
  const out: StoredRecord[] = [];
  const seen = new Set<string>();
  const seenPaths = new Set<string>();
  for (const r of list) {
    if (!isObject(r) || typeof r.trackId !== 'string' || typeof r.filePath !== 'string' || !isObject(r.track)) continue;
    let track = r.track as unknown as Track;
    if (typeof track.id !== 'string' || track.id !== r.trackId) continue;
    // Один файл — одна запись: из записей с одним путём остаётся первая (новые — сверху).
    if (!isAbsolute(r.filePath) || seenPaths.has(pathKey(r.filePath))) continue;
    let formerId = typeof r.formerId === 'string' ? r.formerId : undefined;
    if (!SOURCE_IDS.includes(track.source)) {
      formerId = track.id;
      track = asFileTrack(track, r.filePath);
    }
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    seenPaths.add(pathKey(r.filePath));
    out.push({
      trackId: track.id,
      filePath: r.filePath,
      downloadedAt: typeof r.downloadedAt === 'number' ? r.downloadedAt : 0,
      track,
      ...(typeof r.size === 'number' && typeof r.mtimeMs === 'number' ? { size: r.size, mtimeMs: r.mtimeMs } : {}),
      ...(formerId ? { formerId } : {}),
    });
  }
  return out;
}

/** На месте ли именно скачанный файл записи: обычный файл, и (если запомнены) тот же размер и время изменения. */
async function hasOwnFile(record: StoredRecord): Promise<boolean> {
  try {
    const st = await stat(record.filePath);
    if (!st.isFile()) return false;
    if (record.size === undefined || record.mtimeMs === undefined) return true; // старая запись без отпечатка
    return st.size === record.size && Math.abs(st.mtimeMs - record.mtimeMs) < 1;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Удаление частичного файла (unlink не удаляет папки); дескриптор на Windows может закрыться чуть позже. */
async function removePart(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await unlink(path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') return;
      await sleep(30 * (attempt + 1));
    }
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await sleep(20 * (attempt + 1));
    }
  }
}

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === 'AbortError';

/** Человеческий текст ошибки скачивания (сеть, диск, недоступный трек). */
export function downloadErrorMessage(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOSPC') return 'На диске не хватает места';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'Нет доступа к папке скачивания';
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EINVAL') return 'Папка скачивания недоступна';
  if (err instanceof SourceError || err instanceof RecordsUnavailableError) return err.message;
  const classified = classifyFetchError(err);
  return classified.kind === 'unknown' ? 'Не удалось скачать трек' : classified.message;
}

/** Расширение итогового файла: из пути, который вернул адаптер, иначе из id трека, иначе mp3. */
function finalExtension(written: string, track: Track): string {
  const fromWritten = extname(written).toLowerCase();
  if (AUDIO_EXTENSIONS.has(fromWritten)) return fromWritten.slice(1);
  const fromId = extname(track.sourceId).toLowerCase();
  return AUDIO_EXTENSIONS.has(fromId) ? fromId.slice(1) : 'mp3';
}

interface Job {
  track: Track;
  controller: AbortController;
}

export function createDownloadManager(deps: DownloadDeps): DownloadManager {
  const maxConcurrent = deps.maxConcurrent ?? MAX_CONCURRENT_DOWNLOADS;
  const now = deps.now ?? Date.now;
  const queue: Job[] = [];
  const running = new Map<string, Job>();
  let records: StoredRecord[] | null = null;
  let loading: Promise<StoredRecord[]> | null = null;
  // Переименование в итоговое имя — по одному, чтобы две загрузки не выбрали одно имя.
  let finalizing: Promise<unknown> = Promise.resolve();

  // Задачи, которые сейчас выполняются (для ожидания при выходе), и их частичные файлы.
  const runs = new Set<Promise<void>>();
  const activeParts = new Set<string>();
  let closing = false;

  /** Записи из downloads.json. Неудачное чтение не кэшируется: следующий вызов прочитает заново. */
  async function load(): Promise<StoredRecord[]> {
    if (records) return records;
    loading ??= deps.readRecords().then(
      (raw) => (records = normalizeRecords(raw)),
      (err: unknown) => {
        loading = null;
        throw new RecordsUnavailableError(err);
      },
    );
    return loading;
  }

  async function save(next: StoredRecord[]): Promise<void> {
    records = next;
    await deps.writeRecords(next);
  }

  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = finalizing.catch(() => undefined).then(fn);
    finalizing = run;
    return run;
  }

  /**
   * Удаляет запись и её файл — только если на месте именно скачанный файл (обычный файл с тем же
   * размером и временем изменения). Чужой файл под тем же именем не трогается, запись просто снимается.
   */
  async function removeRecord(trackId: string): Promise<void> {
    const record = (await load()).find((r) => isRecordOf(r, trackId));
    if (!record) return;
    let info: Awaited<ReturnType<typeof lstat>> | null = null;
    try {
      info = await lstat(record.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Не удалось удалить файл');
    }
    // Папку, ссылку или что-то иное не трогаем.
    if (info && !info.isFile()) throw new Error('Это не файл загрузки — удалять не буду');
    if (info && (await hasOwnFile(record))) {
      try {
        await unlink(record.filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Не удалось удалить файл — он занят или нет доступа');
      }
    }
    await save((await load()).filter((r) => r.trackId !== record.trackId));
  }

  function pump(): void {
    while (running.size < maxConcurrent && queue.length > 0) {
      const job = queue.shift()!;
      running.set(job.track.id, job);
      const done = run(job).finally(() => {
        running.delete(job.track.id);
        runs.delete(done);
        pump();
      });
      runs.add(done);
    }
  }

  async function run(job: Job): Promise<void> {
    const { track, controller } = job;
    const download = deps.downloaderFor(track);
    let part: string | null = null;
    let written: string | null = null;
    let lastProgress = -2;
    let partName: string | null = null;
    const progress = (p: number) => {
      if (controller.signal.aborted) return;
      const value = Number.isFinite(p) && p >= 0 ? Math.min(1, p) : -1;
      if (value !== -1 && lastProgress !== -1 && Math.abs(value - lastProgress) < PROGRESS_STEP && value < 1) return;
      if (value === -1 && lastProgress === -1) return;
      lastProgress = value;
      deps.emit({ trackId: track.id, status: 'downloading', progress: value });
    };

    try {
      if (!download) throw new SourceError('unavailable', 'Этот источник пока не умеет скачивать');
      const ctx = await deps.context();
      const dir = ctx.settings.downloadDir;
      if (!dir || !isAbsolute(dir)) throw Object.assign(new Error('bad dir'), { code: 'ENOENT' });
      await mkdir(dir, { recursive: true });
      const plannedExt = finalExtension('', track);
      part = join(dir, `${safeFileName(track.artist, track.title, plannedExt)}.${randomBytes(4).toString('hex')}.part`);
      partName = basename(part);
      activeParts.add(partName);
      deps.emit({ trackId: track.id, status: 'downloading', progress: -1 });
      lastProgress = -1;
      written = await download(track, part, ctx, progress, controller.signal);
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const source = written;
      // Имя выбирается и запись сохраняется под одним замком: путь, который занят файлом на диске
      // или записан за другим треком (даже если его файл удалили), новой загрузке не достаётся.
      const filePath = await serialized(async () => {
        const others = (await load()).filter((r) => r.trackId !== track.id);
        const reserved = new Set(others.map((r) => pathKey(r.filePath)));
        const name = safeFileName(track.artist, track.title, finalExtension(source, track));
        const target = await uniquePath(dir, name, async (p) => reserved.has(pathKey(p)) || (await exists(p)));
        await renameWithRetry(source, target);
        written = null;
        part = null;
        const st = await stat(target);
        const record: StoredRecord = { trackId: track.id, filePath: target, downloadedAt: now(), track, size: st.size, mtimeMs: st.mtimeMs };
        // Один файл — одна запись: чужие записи с тем же путём снимаются.
        await save([record, ...others.filter((r) => pathKey(r.filePath) !== pathKey(target))]);
        return target;
      });
      deps.emit({ trackId: track.id, status: 'done', filePath });
    } catch (err) {
      if (written && written !== part) await removePart(written);
      if (part) await removePart(part);
      if (controller.signal.aborted || isAbort(err)) {
        deps.emit({ trackId: track.id, status: 'cancelled' });
      } else {
        deps.emit({ trackId: track.id, status: 'error', message: downloadErrorMessage(err) });
      }
    } finally {
      if (partName) activeParts.delete(partName);
    }
  }

  return {
    async start(track) {
      if (!track.downloadable) {
        throw new Error(track.source === 'local' ? 'Файл уже на диске' : 'Автор запретил скачивание');
      }
      if (!deps.downloaderFor(track)) throw new Error('Этот источник пока не умеет скачивать');
      if (closing) throw new Error('Приложение закрывается');
      if (running.has(track.id) || queue.some((j) => j.track.id === track.id)) return;
      const existing = (await load()).find((r) => isRecordOf(r, track.id));
      if (existing && (await hasOwnFile(existing))) {
        deps.emit({ trackId: track.id, status: 'done', filePath: existing.filePath });
        return;
      }
      if (closing || running.has(track.id) || queue.some((j) => j.track.id === track.id)) return;
      queue.push({ track, controller: new AbortController() });
      deps.emit({ trackId: track.id, status: 'queued' });
      pump();
    },

    async cancel(trackId) {
      const queued = queue.findIndex((j) => j.track.id === trackId);
      if (queued >= 0) {
        queue.splice(queued, 1);
        deps.emit({ trackId, status: 'cancelled' });
        return;
      }
      running.get(trackId)?.controller.abort();
    },

    async list() {
      const list = await load();
      const entries = await Promise.all(
        list.map(async (r) => {
          const { size: _size, mtimeMs: _mtime, formerId: _former, ...record } = r; // отпечаток файла и прежний id наружу не отдаём
          return { ...record, missing: !(await hasOwnFile(r)) };
        }),
      );
      return entries.sort((a, b) => b.downloadedAt - a.downloadedAt);
    },

    remove(trackId) {
      return serialized(() => removeRecord(trackId));
    },

    async recordedFiles() {
      return (await load()).map((r) => r.filePath);
    },

    async findFile(trackId) {
      // Список не прочитался — играем из сети, как будто копии нет.
      const list = await load().catch(() => [] as StoredRecord[]);
      const record = list.find((r) => isRecordOf(r, trackId));
      return record && (await hasOwnFile(record)) ? record.filePath : null;
    },

    async cancelAll(timeoutMs = QUIT_CANCEL_TIMEOUT_MS) {
      closing = true;
      for (const job of queue.splice(0)) deps.emit({ trackId: job.track.id, status: 'cancelled' });
      for (const job of running.values()) job.controller.abort();
      if (runs.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...runs]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
    },

    async sweepLeftovers() {
      const dir = (await deps.context()).settings.downloadDir;
      if (!dir || !isAbsolute(dir)) return;
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return; // папки ещё нет или она недоступна — убирать нечего
      }
      for (const name of names) {
        if (!LEFTOVER_PART.test(name)) continue;
        if ([...activeParts].some((p) => name.startsWith(p))) continue;
        const path = join(dir, name);
        try {
          if (!(await lstat(path)).isFile()) continue; // папки и ссылки не трогаем
        } catch {
          continue;
        }
        await removePart(path);
      }
    },
  };
}
