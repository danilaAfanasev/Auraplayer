// «Мои файлы»: рекурсивный обход папок пользователя (mp3, m4a, flac, ogg, opus, wav), теги и обложки
// через music-metadata. Обложки кэшируются в `userData/covers` (имя — хеш картинки: у альбома одна).
// Индекс — `local-index.json`: при пересканировании заново читаются только изменившиеся файлы.
// Файлы пользователя только читаются — модуль ничего в папках «Моих файлов» не пишет и не удаляет.
import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseFile } from 'music-metadata';
import { makeTrackId, type Track } from '../../shared/types';
import { mediaUrl } from '../protocol';
import { readJson, writeJson } from '../store';
import { SourceError, type SourceAdapter, type SourceContext } from './types';

export const LOCAL_INDEX_FILE = 'local-index.json';
export const COVERS_DIR = 'covers';
export const LOCAL_EXTENSIONS = new Set(['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav']);

const MAX_FILES = 20_000;
const MAX_DEPTH = 24;
const PARSE_CONCURRENCY = 4;
const SEARCH_LIMIT = 100;
const UNKNOWN_ARTIST = 'Неизвестный исполнитель';
const COVER_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

interface IndexedFile {
  mtimeMs: number;
  size: number;
  track: Track;
}

export interface LocalIndex {
  version: 1;
  files: Record<string, IndexedFile>;
}

/** Трек «Моих файлов» + отметка, что файла сейчас нет на диске. */
export type LocalTrack = Track & { missing?: boolean };

export interface ScanOptions {
  coversDir: string;
  /** Прошлый индекс: неизменившиеся файлы (время и размер) не читаются заново. */
  previous?: LocalIndex | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function normalizeIndex(raw: unknown): LocalIndex {
  const files: Record<string, IndexedFile> = {};
  if (isObject(raw) && isObject(raw.files)) {
    for (const [path, f] of Object.entries(raw.files)) {
      if (!isObject(f) || !isObject(f.track) || typeof f.mtimeMs !== 'number' || typeof f.size !== 'number') continue;
      const track = f.track as unknown as Track;
      if (track.source !== 'local' || track.sourceId !== path || typeof track.title !== 'string') continue;
      files[path] = { mtimeMs: f.mtimeMs, size: f.size, track };
    }
  }
  return { version: 1, files };
}

/** Все аудиофайлы папки и вложенных папок. Ссылки на папки не обходятся (нет петель). */
async function collectFiles(root: string, out: Set<string>): Promise<void> {
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || out.size >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // нет доступа или папки — пропускаем
    }
    for (const e of entries) {
      if (out.size >= MAX_FILES) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && LOCAL_EXTENSIONS.has(extname(e.name).toLowerCase())) out.add(full);
    }
  };
  await walk(root, 0);
}

async function saveCover(data: Uint8Array, format: string, coversDir: string): Promise<string | undefined> {
  const ext = COVER_EXT[format.toLowerCase()];
  if (!ext || data.length === 0 || data.length > 10 * 1024 * 1024) return undefined;
  const name = `${createHash('sha1').update(data).digest('hex').slice(0, 24)}.${ext}`;
  const path = join(coversDir, name);
  try {
    await stat(path);
  } catch {
    await mkdir(coversDir, { recursive: true });
    await writeFile(path, data);
  }
  return mediaUrl(path);
}

const first = (v: unknown): string => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? first(v[0]) : '');

async function readTrack(path: string, coversDir: string): Promise<Track> {
  const fallbackTitle = basename(path, extname(path)).trim() || basename(path);
  const track: Track = {
    id: makeTrackId('local', path),
    source: 'local',
    sourceId: path,
    title: fallbackTitle,
    artist: UNKNOWN_ARTIST,
    downloadable: false,
  };
  try {
    const meta = await parseFile(path, { skipCovers: false });
    const { common, format } = meta;
    const title = first(common.title);
    const artist = first(common.artist) || first(common.artists) || first(common.albumartist);
    const album = first(common.album);
    if (title) track.title = title;
    if (artist) track.artist = artist;
    if (album) track.album = album;
    if (typeof format.duration === 'number' && Number.isFinite(format.duration) && format.duration > 0) {
      track.durationSec = Math.round(format.duration * 10) / 10;
    }
    const genres = (common.genre ?? []).map((g) => g.trim()).filter(Boolean);
    if (genres.length) track.tags = genres;
    const picture = common.picture?.[0];
    if (picture) {
      const cover = await saveCover(picture.data, picture.format, coversDir).catch(() => undefined);
      if (cover) track.coverUrl = cover;
    }
  } catch {
    // Тегов нет или файл не разобрался — остаётся название из имени файла.
  }
  return track;
}

/** Обходит папки и читает теги. Неизменившиеся файлы берутся из `previous`. */
export async function scanFolders(folders: string[], opts: ScanOptions): Promise<{ tracks: Track[]; index: LocalIndex }> {
  const paths = new Set<string>();
  for (const folder of folders) {
    if (typeof folder === 'string' && isAbsolute(folder)) await collectFiles(resolve(folder), paths);
  }
  const previous = opts.previous?.files ?? {};
  const list = [...paths];
  const files: Record<string, IndexedFile> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const path = list[cursor++];
      let info;
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      const old = previous[path];
      const track =
        old && old.mtimeMs === info.mtimeMs && old.size === info.size ? old.track : await readTrack(path, opts.coversDir);
      files[path] = { mtimeMs: info.mtimeMs, size: info.size, track };
    }
  };
  await Promise.all(Array.from({ length: PARSE_CONCURRENCY }, worker));
  const tracks = list.filter((p) => files[p]).map((p) => files[p].track);
  tracks.sort((a, b) => a.sourceId.localeCompare(b.sourceId, 'ru'));
  return { tracks, index: { version: 1, files } };
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

const inFolders = (path: string, folders: string[]): boolean =>
  folders.some((f) => typeof f === 'string' && isAbsolute(f) && isInside(resolve(f), path));

/** Для поиска: без регистра и диакритики (ё → е, ó → o). */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export interface LocalDeps {
  readIndex(): Promise<unknown>;
  writeIndex(index: LocalIndex): Promise<void>;
}

export interface LocalLibrary {
  adapter: SourceAdapter;
  /** Пересканировать папки из настроек; возвращает найденные треки. */
  rescan(ctx: SourceContext): Promise<Track[]>;
  /** Треки из индекса (только папок, которые сейчас в настройках) с отметкой `missing`. */
  tracks(ctx: SourceContext): Promise<LocalTrack[]>;
}

export function createLocalLibrary(deps: LocalDeps): LocalLibrary {
  let index: LocalIndex | null = null;
  let scanning: Promise<Track[]> | null = null;

  async function load(): Promise<LocalIndex> {
    if (!index) index = normalizeIndex(await Promise.resolve().then(() => deps.readIndex()).catch(() => null));
    return index;
  }

  async function indexed(ctx: SourceContext): Promise<Track[]> {
    const folders = ctx.settings.localFolders;
    return Object.values((await load()).files)
      .map((f) => f.track)
      .filter((t) => inFolders(t.sourceId, folders))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId, 'ru'));
  }

  const adapter: SourceAdapter = {
    id: 'local',
    async search(query, ctx) {
      const words = fold(query).split(/\s+/).filter(Boolean);
      if (words.length === 0) return [];
      const out: Track[] = [];
      for (const t of await indexed(ctx)) {
        const hay = fold(`${t.title} ${t.artist} ${t.album ?? ''} ${basename(t.sourceId)}`);
        if (words.every((w) => hay.includes(w))) out.push(t);
        if (out.length >= SEARCH_LIMIT) break;
      }
      return out;
    },
    async byTag(tag, ctx) {
      const want = fold(tag);
      return (await indexed(ctx)).filter((t) => t.tags?.some((g) => fold(g).includes(want))).slice(0, SEARCH_LIMIT);
    },
    async resolveStream(track, ctx) {
      const path = track.sourceId;
      if (!isAbsolute(path) || !inFolders(resolve(path), ctx.settings.localFolders)) {
        throw new SourceError('unavailable', 'Файл не из папок «Моих файлов»');
      }
      if (!(await isFile(path))) throw new SourceError('unavailable', 'Файл не найден');
      return mediaUrl(path);
    },
  };

  return {
    adapter,
    rescan(ctx) {
      // Повторный запрос во время сканирования ждёт текущее.
      scanning ??= (async () => {
        try {
          const coversDir = join(ctx.userDataDir, COVERS_DIR);
          const result = await scanFolders(ctx.settings.localFolders, { coversDir, previous: await load() });
          index = result.index;
          await deps.writeIndex(result.index);
          return result.tracks;
        } finally {
          scanning = null;
        }
      })();
      return scanning;
    },
    async tracks(ctx) {
      const list = await indexed(ctx);
      const present = await Promise.all(list.map((t) => isFile(t.sourceId)));
      return list.map((t, i) => (present[i] ? t : { ...t, missing: true }));
    },
  };
}

export const localLibrary = createLocalLibrary({
  readIndex: () => readJson<unknown>(LOCAL_INDEX_FILE, null),
  writeIndex: (index) => writeJson(LOCAL_INDEX_FILE, index),
});

export const local = localLibrary.adapter;
