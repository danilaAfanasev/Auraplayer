// Internet Archive: advancedsearch.php (mediatype:audio) → файлы элемента (metadata/{id}/files) →
// MP3-файлы как отдельные треки. Ключ не нужен. Поток — archive.org/download/{id}/{файл}.
import { GENRES } from '../../shared/genres';
import { makeTrackId, type Track } from '../../shared/types';
import { fetchToFile, type FetchFile } from './fetchFile';
import { fetchJson as defaultFetchJson } from './http';
import { SourceError, type SourceAdapter } from './types';

export type FetchJson = (url: string, timeoutMs?: number) => Promise<unknown>;

export interface ArchiveItem {
  identifier: string;
  title: string;
  creator: string;
}

const SEARCH_URL = 'https://archive.org/advancedsearch.php';
const BASE = 'https://archive.org';
/** Музыкальные коллекции: без аудиокниг, радиоспектаклей и подкастов. */
const MUSIC_COLLECTIONS = 'collection:(netlabels OR opensource_audio OR audio_music)';
/** Элементов на запрос и треков с элемента — чтобы ответ приходил за пару секунд. */
const ITEMS_PER_QUERY = 10;
const FILES_PER_ITEM = 5;
const MAX_TRACKS = 40;
/** Список файлов элемента бывает в мегабайты: медленный элемент пропускаем, а не ждём. */
const ITEM_TIMEOUT_MS = 4_000;
/** Кэш ответов: повторный поиск и возврат на главную — без ожидания. */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 50;
const UNKNOWN_ARTIST = 'Неизвестный исполнитель';

/** Качество MP3-форматов Archive: чем меньше, тем лучше. */
const MP3_RANK: Record<string, number> = { 'vbr mp3': 0, mp3: 1, '320kbps mp3': 1, '256kbps mp3': 2, '128kbps mp3': 3, '64kbps mp3': 4 };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  return '';
}

/** Элементы из ответа advancedsearch.php. */
export function parseArchiveSearch(json: unknown): ArchiveItem[] {
  if (!isObject(json) || !isObject(json.response) || !Array.isArray(json.response.docs)) return [];
  const out: ArchiveItem[] = [];
  for (const d of json.response.docs) {
    if (!isObject(d)) continue;
    const identifier = text(d.identifier);
    if (!identifier) continue;
    out.push({ identifier, title: text(d.title) || identifier, creator: text(d.creator) });
  }
  return out;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Теги, записанные в UTF-8, но прочитанные как Latin-1 («fanÄ6» → «fanā6»), — возвращаем как было задумано. */
function repairMojibake(s: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return s;
  try {
    return utf8.decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

/** «240.9» → 240.9; «05:23» → 323; «1:02:05» → 3725. */
function parseLength(v: unknown): number | undefined {
  const s = text(v);
  if (!s) return undefined;
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return undefined;
    const sec = parts.reduce((acc, n) => acc * 60 + n, 0);
    return sec > 0 ? sec : undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Номер дорожки: «1/15» → 1, «03» → 3. */
function trackNo(v: unknown): number {
  const n = parseInt(text(v), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

const baseName = (name: string): string => name.split('/').pop()!.replace(/\.[^.]+$/, '');

/**
 * MP3-файлы элемента как треки. `meta` — ответ `metadata/{id}` (поле `files`) или `metadata/{id}/files` (`result`).
 * Из нескольких MP3 одной записи (оригинал и производные разного битрейта) остаётся лучший.
 */
export function parseArchiveFiles(meta: unknown, item: ArchiveItem, max = Number.POSITIVE_INFINITY): Track[] {
  if (!isObject(meta)) return [];
  const files = Array.isArray(meta.result) ? meta.result : Array.isArray(meta.files) ? meta.files : [];

  const best = new Map<string, { file: Record<string, unknown>; rank: number }>();
  for (const f of files) {
    if (!isObject(f)) continue;
    const name = text(f.name);
    const rank = MP3_RANK[text(f.format).toLowerCase()];
    if (!name || rank === undefined || !/\.mp3$/i.test(name)) continue;
    const key = text(f.original) || name;
    const prev = best.get(key);
    if (!prev || rank < prev.rank) best.set(key, { file: f, rank });
  }

  const chosen = [...best.values()]
    .map((b) => b.file)
    .sort((a, b) => trackNo(a.track) - trackNo(b.track) || text(a.name).localeCompare(text(b.name)));

  const tracks: Track[] = [];
  for (const f of chosen) {
    if (tracks.length >= max) break;
    const name = text(f.name);
    const sourceId = `${item.identifier}/${name}`;
    const duration = parseLength(f.length);
    tracks.push({
      id: makeTrackId('archive', sourceId),
      source: 'archive',
      sourceId,
      title: repairMojibake(text(f.title) || baseName(name)),
      artist: repairMojibake(text(f.artist) || text(f.creator) || item.creator || UNKNOWN_ARTIST),
      album: repairMojibake(text(f.album) || item.title),
      ...(duration ? { durationSec: Math.floor(duration * 10) / 10 } : {}),
      coverUrl: `${BASE}/services/img/${encodeURIComponent(item.identifier)}`,
      downloadable: true,
      pageUrl: `${BASE}/details/${encodeURIComponent(item.identifier)}`,
    });
  }
  return tracks;
}

/** URL файла для `<audio>`: `sourceId` = `{identifier}/{путь файла}`. */
export function archiveStreamUrl(sourceId: string): string {
  return `${BASE}/download/${sourceId.split('/').map(encodeURIComponent).join('/')}`;
}

/** Слова запроса без спецсимволов синтаксиса Lucene. */
function sanitize(query: string): string {
  return query
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .replace(/\b(AND|OR|NOT)\b/g, (w) => w.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/** Варианты тега в subject Archive (жанр пишут по-разному). */
function subjectVariants(tag: string): string[] {
  const variants: Record<string, string[]> = {
    hiphop: ['hiphop', '"hip hop"', '"hip-hop"'],
    electronic: ['electronic', 'electronica'],
    chillout: ['chillout', '"chill out"', 'chill'],
    soundtrack: ['soundtrack', '"film music"'],
  };
  if (variants[tag]) return variants[tag];
  const known = GENRES.some((g) => g.tag === tag);
  const clean = sanitize(tag);
  return known || !clean.includes(' ') ? [clean] : [`"${clean}"`];
}

function searchUrl(q: string, sort: string): string {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', q);
  for (const f of ['identifier', 'title', 'creator']) url.searchParams.append('fl[]', f);
  url.searchParams.set('rows', String(ITEMS_PER_QUERY));
  url.searchParams.set('page', '1');
  url.searchParams.set('output', 'json');
  url.searchParams.append('sort[]', sort);
  return url.toString();
}

export function createArchiveAdapter(fetchJson: FetchJson = defaultFetchJson, fetchFile: FetchFile = fetchToFile): SourceAdapter {
  const cache = new Map<string, { at: number; tracks: Track[] }>();

  async function tracksOf(q: string, sort: string): Promise<Track[]> {
    const key = `${sort}|${q}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.tracks;
    const tracks = await fetchTracks(q, sort);
    if (tracks.length > 0) {
      cache.set(key, { at: Date.now(), tracks });
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return tracks;
  }

  async function fetchTracks(q: string, sort: string): Promise<Track[]> {
    const items = parseArchiveSearch(await fetchJson(searchUrl(q, sort)));
    // Файлы элементов — параллельно; упавший элемент пропускаем, остальные показываем.
    const perItem = await Promise.all(
      items.map(async (item) => {
        try {
          const meta = await fetchJson(`${BASE}/metadata/${encodeURIComponent(item.identifier)}/files`, ITEM_TIMEOUT_MS);
          return parseArchiveFiles(meta, item, FILES_PER_ITEM);
        } catch {
          return [];
        }
      }),
    );
    // По очереди из каждого элемента — чтобы список не состоял из одного альбома подряд.
    const mixed: Track[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < FILES_PER_ITEM; i++) {
      for (const list of perItem) {
        const t = list[i];
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          mixed.push(t);
        }
      }
    }
    return mixed.slice(0, MAX_TRACKS);
  }

  return {
    id: 'archive',
    async search(query) {
      const words = sanitize(query);
      if (!words) return [];
      return tracksOf(`(${words}) AND mediatype:(audio) AND ${MUSIC_COLLECTIONS}`, 'downloads desc');
    },
    featured() {
      // Популярное недели в нетлейблах, только музыкальные жанры (без записей эфира и шумовых архивов).
      const genres = GENRES.map((g) => g.tag).join(' OR ');
      return tracksOf(`mediatype:(audio) AND collection:(netlabels) AND format:(VBR MP3) AND subject:(${genres})`, 'week desc');
    },
    byTag(tag) {
      const subject = subjectVariants(tag).join(' OR ');
      return tracksOf(`subject:(${subject}) AND mediatype:(audio) AND ${MUSIC_COLLECTIONS}`, 'downloads desc');
    },
    async resolveStream(track) {
      if (!track.sourceId.includes('/')) throw new SourceError('unavailable', 'Трек недоступен');
      return archiveStreamUrl(track.sourceId);
    },
    async download(track, destPath, _ctx, onProgress, signal) {
      if (!track.sourceId.includes('/')) throw new SourceError('unavailable', 'Трек недоступен');
      return fetchFile(archiveStreamUrl(track.sourceId), destPath, onProgress, signal);
    },
  };
}

export const archive = createArchiveAdapter();
