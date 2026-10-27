// Атомарное JSON-хранилище в папке userData.
// Запись: временный файл рядом + rename (файл всегда либо старый, либо новый целиком).
// Чтение: нет файла → fallback; повреждённый файл → переименовывается в `<name>.bak`, возвращается fallback;
// файл временно занят → чтение повторяется, так и не прочитался → ошибка (не fallback).
// Модуль не импортирует electron: папку задаёт main при старте (`setStoreDir(app.getPath('userData'))`).
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface JsonStore {
  readJson<T>(name: string, fallback: T): Promise<T>;
  writeJson(name: string, data: unknown): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Все идущие записи всех хранилищ — чтобы перед выходом дождаться их (`flushWrites`). */
const inflight = new Set<Promise<void>>();

/** Дожидается окончания всех начатых записей (в том числе поставленных в очередь во время ожидания). */
export async function flushWrites(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
}

/** Коды, которыми Windows кратко отвечает на файл, занятый антивирусом или OneDrive. */
function isTransientLock(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

/** Повторяет операцию с файлом, пока он временно заблокирован (до 8 повторов, ~0,5 с). */
async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (attempt >= 8 || !isTransientLock(err)) throw err;
      await sleep(15 * (attempt + 1));
    }
  }
}

/** rename на Windows может кратко упираться в EPERM/EBUSY (антивирус, OneDrive) — повторяем. */
const renameWithRetry = (from: string, to: string): Promise<void> => withRetry(() => rename(from, to));

export function createJsonStore(dir: string): JsonStore {
  // Очередь записей по каждому файлу: записи одного файла идут строго друг за другом.
  const queues = new Map<string, Promise<void>>();

  async function writeNow(name: string, data: unknown): Promise<void> {
    await mkdir(dir, { recursive: true });
    const file = join(dir, name);
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', flush: true });
      await renameWithRetry(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  return {
    async readJson<T>(name: string, fallback: T): Promise<T> {
      // Дожидаемся записи этого файла, если она идёт, чтобы не прочитать устаревшее.
      await queues.get(name)?.catch(() => undefined);
      const file = join(dir, name);
      let text: string;
      try {
        text = await withRetry(() => readFile(file, 'utf8'));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
        // Файл есть, но не читается: это не «пусто». Решает вызывающий — иначе первое же
        // сохранение затрёт настоящие данные заглушкой.
        if (!isTransientLock(err)) throw err;
        throw Object.assign(new Error(`файл ${name} занят другой программой или нет доступа`), {
          code: (err as NodeJS.ErrnoException).code,
          cause: err,
        });
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        await renameWithRetry(file, `${file}.bak`).catch(() => undefined);
        return fallback;
      }
    },

    writeJson(name: string, data: unknown): Promise<void> {
      const prev = queues.get(name) ?? Promise.resolve();
      const next = prev.catch(() => undefined).then(() => writeNow(name, data));
      queues.set(name, next);
      inflight.add(next);
      void next
        .finally(() => {
          inflight.delete(next);
          if (queues.get(name) === next) queues.delete(name);
        })
        .catch(() => undefined);
      return next;
    },
  };
}

let defaultStore: JsonStore | null = null;

/** Папка хранилища по умолчанию — вызывается из main при старте с `app.getPath('userData')`. */
export function setStoreDir(dir: string): void {
  defaultStore = createJsonStore(dir);
}

function store(): JsonStore {
  if (!defaultStore) throw new Error('Хранилище не инициализировано: вызовите setStoreDir()');
  return defaultStore;
}

export function readJson<T>(name: string, fallback: T): Promise<T> {
  return store().readJson(name, fallback);
}

export function writeJson(name: string, data: unknown): Promise<void> {
  return store().writeJson(name, data);
}
