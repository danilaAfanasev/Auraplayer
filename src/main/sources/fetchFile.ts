// Скачивание файла по HTTP(S) на диск с прогрессом и отменой — общий для download-методов адаптеров.
// Файл создаётся заново (`wx`: существующий не перезаписывается); при ошибке остаётся частичный файл —
// его удаляет очередь загрузок (`downloads.ts`).
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { classifyFetchError } from './http';
import { SourceError } from './types';

export type FetchFile = (url: string, destPath: string, onProgress: (p: number) => void, signal: AbortSignal) => Promise<string>;

/** Нет ни байта столько времени — соединение считаем оборванным. */
const IDLE_TIMEOUT_MS = 30_000;
const NOT_AVAILABLE = new Set([401, 403, 404, 410, 451]);

const abortError = () => new DOMException('Aborted', 'AbortError');

export const fetchToFile: FetchFile = async (url, destPath, onProgress, signal) => {
  if (signal.aborted) throw abortError();
  const idle = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
  };
  const combined = AbortSignal.any([signal, idle.signal]);
  // Сбой из-за отмены пользователем — AbortError; из-за тишины в сети — «нет соединения».
  const rethrow = (err: unknown): never => {
    if (signal.aborted) throw abortError();
    if (idle.signal.aborted) throw new SourceError('offline', 'Соединение оборвалось');
    throw err;
  };

  touch();
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: combined, redirect: 'follow', headers: { 'User-Agent': 'Aura/0.1 (desktop audio player)' } });
    } catch (err) {
      return rethrow(classifyFetchError(err));
    }
    if (!res.ok || !res.body) {
      throw new SourceError('unavailable', NOT_AVAILABLE.has(res.status) ? 'Трек недоступен для скачивания' : 'Сервис недоступен');
    }
    if ((res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) {
      await res.body.cancel().catch(() => undefined);
      throw new SourceError('unavailable', 'Трек недоступен для скачивания');
    }

    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    onProgress(total > 0 ? 0 : -1);
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        touch();
        received += chunk.length;
        if (total > 0) onProgress(Math.min(1, received / total));
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>),
        counter,
        createWriteStream(destPath, { flags: 'wx' }),
        { signal: combined },
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && !code.startsWith('UND_') && code !== 'ABORT_ERR' && code !== 'ECONNRESET') throw err; // ошибка диска — как есть
      return rethrow(classifyFetchError(err));
    }
    if (total > 0 && received < total) throw new SourceError('offline', 'Соединение оборвалось');
    onProgress(1);
    return destPath;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
};
