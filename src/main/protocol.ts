// Протокол `aura-media://file/<encodeURIComponent(абсолютный путь)>`: скачанные и локальные файлы
// и кэш обложек для <audio>/<img> рендерера, с поддержкой Range (перемотка).
// Отдаются ТОЛЬКО аудио и картинки из разрешённых папок (папка скачивания, «Мои файлы», кэш обложек)
// и отдельные разрешённые файлы (записи загрузок). Путь проверяется дважды: как написан (после
// нормализации `..`) и после разрешения ссылок (`realpath`: симлинки, junction). Всё прочее — 403.
// Модуль не импортирует electron во время выполнения: объект `protocol` передаёт main (`registerMediaProtocol`).
import type { CustomScheme, Protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

export const MEDIA_SCHEME = 'aura-media';
const MEDIA_HOST = 'file';

/** Регистрируется до `app.whenReady()`: стандартная безопасная схема с потоковой отдачей (нужно для перемотки). */
export const MEDIA_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
};

/** Разрешённые папки (рекурсивно) и отдельные файлы. */
export interface MediaRoots {
  dirs: string[];
  files?: string[];
}

export type MediaResolution = { ok: true; path: string; size: number; mime: string } | { ok: false; status: 400 | 403 | 404 };

/** Типы, которые протокол вообще согласен отдавать: звук и картинки. */
const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/** URL файла для `<audio>`/`<img>`. */
export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encodeURIComponent(path)}`;
}

const WIN_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/**
 * Обычный абсолютный путь: на Windows — только «X:\…» (без UNC `\\server`, устройств `\\?\`, `\\.\`
 * и потоков NTFS `file:stream`).
 */
function isPlainAbsolute(p: string): boolean {
  if (process.platform === 'win32') return WIN_DRIVE_PATH.test(p) && !p.slice(2).includes(':');
  return isAbsolute(p) && !p.startsWith('//');
}

/** `target` лежит внутри `root` (не сама папка, не соседняя с тем же префиксом, не на другом диске). */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

const isSame = (a: string, b: string): boolean => relative(a, b) === '';

function isAllowed(target: string, roots: MediaRoots): boolean {
  return roots.dirs.some((d) => isInside(d, target)) || (roots.files ?? []).some((f) => isSame(f, target));
}

async function realOrNull(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

async function realRoots(roots: MediaRoots): Promise<MediaRoots> {
  const real = async (list: string[]) =>
    (await Promise.all(list.filter(isPlainAbsolute).map((p) => realOrNull(resolve(p))))).filter((p): p is string => p !== null);
  return { dirs: await real(roots.dirs), files: await real(roots.files ?? []) };
}

/** Путь файла из URL протокола или null, если URL не наш или испорчен. Декодируется ровно один раз. */
function pathFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${MEDIA_SCHEME}:` || u.hostname !== MEDIA_HOST) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0')) return null;
  return decoded;
}

/** Проверяет запрос и находит файл. Ничего не читает за пределами разрешённого. */
export async function resolveMediaRequest(url: string, roots: MediaRoots): Promise<MediaResolution> {
  const raw = pathFromUrl(url);
  if (raw === null) return { ok: false, status: 400 };
  if (!isPlainAbsolute(raw)) return { ok: false, status: 403 };

  const lexical = resolve(raw); // убирает `..`, `.`, приводит разделители
  if (!MIME[extname(lexical).toLowerCase()]) return { ok: false, status: 403 };

  const lexicalRoots: MediaRoots = {
    dirs: roots.dirs.filter(isPlainAbsolute).map((p) => resolve(p)),
    files: (roots.files ?? []).filter(isPlainAbsolute).map((p) => resolve(p)),
  };
  // Сначала — путь как написан: о файлах вне разрешённого не сообщаем даже, существуют ли они.
  if (!isAllowed(lexical, lexicalRoots)) return { ok: false, status: 403 };

  const real = await realOrNull(lexical);
  if (real === null) return { ok: false, status: 404 };
  // Затем — настоящий путь после разрешения ссылок: junction/симлинк наружу не проходит.
  if (!isPlainAbsolute(real) || !isAllowed(real, await realRoots(roots))) return { ok: false, status: 403 };
  const mime = MIME[extname(real).toLowerCase()];
  if (!mime) return { ok: false, status: 403 };

  try {
    const st = await stat(real);
    if (!st.isFile()) return { ok: false, status: 403 };
    return { ok: true, path: real, size: st.size, mime };
  } catch {
    return { ok: false, status: 404 };
  }
}

/** Заголовок `Range: bytes=…` (один диапазон). null — отдать весь файл. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** Ответ протокола на запрос рендерера. */
export async function mediaResponse(request: Request, roots: MediaRoots): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  const res = await resolveMediaRequest(request.url, roots);
  if (!res.ok) return new Response(null, { status: res.status });

  const headers: Record<string, string> = {
    'Content-Type': res.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = parseRange(request.headers.get('range'), res.size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${res.size}` } });
  }
  if (res.size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });

  const { start, end } = range ?? { start: 0, end: res.size - 1 };
  headers['Content-Length'] = String(end - start + 1);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${res.size}`;
  const body =
    request.method === 'HEAD' ? null : (Readable.toWeb(createReadStream(res.path, { start, end })) as unknown as ReadableStream<Uint8Array>);
  return new Response(body, { status: range ? 206 : 200, headers });
}

/** Подключает обработчик схемы (после `app.whenReady()`). Разрешённое читается при каждом запросе. */
export function registerMediaProtocol(protocol: Pick<Protocol, 'handle'>, getRoots: () => Promise<MediaRoots>): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      return await mediaResponse(request, await getRoots());
    } catch {
      return new Response(null, { status: 500 });
    }
  });
}
