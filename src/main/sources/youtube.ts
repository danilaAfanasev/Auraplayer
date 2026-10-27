// YouTube через yt-dlp — строго анонимно (G01): без входа, куки и учётных данных (это гарантирует runYtDlp).
// Поиск — `ytsearch20:` с плоским JSON; поток — прямой https-URL лучшего аудиоформата (webm/opus или m4a);
// скачивание — аудио m4a как есть, без перекодирования (ffmpeg не нужен).
import { readdir, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isLikelyTrack } from '../../shared/trackFilter';
import { makeTrackId, type Track } from '../../shared/types';
import { runYtDlp, YtDlpError } from '../ytdlp';
import { SourceError, type AdapterStreamOptions, type SourceAdapter } from './types';

export type RunYtDlp = typeof runYtDlp;

const SEARCH_LIMIT = 20;
/** Поиск: запуск yt-dlp + ответ YouTube. */
const SEARCH_TIMEOUT_MS = 45_000;
/**
 * Поток: плеер ждёт звук YouTube без таймера (в России без VPN ответ может идти минуту),
 * но зависший yt-dlp всё же обрываем — плеер сделает повторную попытку.
 */
const STREAM_TIMEOUT_MS = 90_000;
/** Ссылка на поток живёт ~6 ч; держим меньше, с запасом. */
const STREAM_CACHE_MS = 60 * 60_000;
const STREAM_CACHE_LIMIT = 200;

/** Порядок: webm/opus (лучше звучит и перематывается), затем m4a; только прямой https — `<audio>` не играет HLS. */
export const STREAM_FORMAT = 'bestaudio[protocol=https][ext=webm]/bestaudio[protocol=https][ext=m4a]/bestaudio[protocol=https]';
/**
 * Быстрый клиент YouTube: visionos отдаёт прямые ссылки без задачи JS (не нужны запуск рантайма и плеер YouTube),
 * HLS/DASH-манифесты не запрашиваются — `<audio>` их всё равно не играет. Проверено в октябре 2026 через VPN:
 * ~2,7 с против ~4,4 с у клиентов по умолчанию, 16 видео из 16. Не дал звука — повтор с клиентами по умолчанию.
 */
export const YT_FAST_CLIENT_ARGS: readonly string[] = ['--extractor-args', 'youtube:player_client=visionos;skip=hls,dash'];
/** Клиенты по умолчанию (надёжнее, но с задачей JS); манифесты так же не нужны. */
export const YT_DEFAULT_CLIENT_ARGS: readonly string[] = ['--extractor-args', 'youtube:skip=hls,dash'];
/** Скачивание: m4a без перекодирования; если m4a нет — лучшее аудио как есть. */
const DOWNLOAD_FORMAT = 'bestaudio[ext=m4a]/bestaudio';
/** Запасной вариант, если m4a не отдаётся: webm/opus или другое аудио — тоже без перекодирования. */
const FALLBACK_DOWNLOAD_FORMAT = 'bestaudio[ext=webm]/bestaudio[ext!=m4a]';
/** Ошибки самой загрузки файла, после которых стоит попробовать другой формат. */
const DOWNLOAD_RETRYABLE = /\[download\] Got error|HTTP Error (403|5\d\d)/i;
const PROGRESS_PREFIX = '[aura]';

export const YT_SLOW_MESSAGE = 'YouTube не отвечает. В России без VPN он может работать медленно или не работать';
const YT_OUTDATED_MESSAGE = 'YouTube изменился — обнови yt-dlp в настройках (раздел YouTube)';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UNKNOWN_ARTIST = 'YouTube';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/** Широкая (16:9) миниатюра наибольшего размера; иначе стабильный mqdefault без чёрных полос. */
function pickCover(id: string, thumbnails: unknown): string {
  let best: { url: string; width: number } | null = null;
  if (Array.isArray(thumbnails)) {
    for (const t of thumbnails) {
      if (!isObject(t)) continue;
      const url = str(t.url);
      const width = typeof t.width === 'number' ? t.width : 0;
      const height = typeof t.height === 'number' ? t.height : 0;
      if (!url.startsWith('https://') || !width || !height || width / height < 1.7) continue;
      if (!best || width > best.width) best = { url, width };
    }
  }
  return best?.url ?? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** «Исполнитель - Название» (дефис/тире с пробелами) → две части; иначе null. */
export function splitArtistTitle(title: string): { artist: string; title: string } | null {
  const m = /^(.{1,80}?)\s+[-–—]\s+(.+)$/.exec(title);
  if (!m) return null;
  const artist = m[1].trim();
  const rest = m[2].trim();
  return artist && rest ? { artist, title: rest } : null;
}

/** Канал «X - Topic» — автоканал исполнителя X. */
const TOPIC_CHANNEL = /\s+-\s+Topic$/i;
/** Название ролика — официальное аудио («Official Audio», «Provided to YouTube»). */
const OFFICIAL_AUDIO_TITLE = /official\s+audio|provided\s+to\s+youtube/i;
const channelName = (s: string): string => s.replace(TOPIC_CHANNEL, '').trim();

/**
 * Треки из плоского JSON `ytsearchN:` (`--flat-playlist -J`). Трансляции, каналы и плейлисты пропускаются.
 * `official` — канал «- Topic» или «Official Audio» в названии; отсев не-треков (`isLikelyTrack`) — на вызывающем.
 */
export function parseYtSearch(json: unknown): Track[] {
  if (!isObject(json) || !Array.isArray(json.entries)) return [];
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const e of json.entries) {
    if (!isObject(e)) continue;
    const id = str(e.id);
    if (!VIDEO_ID.test(id) || seen.has(id)) continue;
    if (e.ie_key !== undefined && e.ie_key !== 'Youtube') continue;
    const live = str(e.live_status);
    if (live === 'is_live' || live === 'is_upcoming' || live === 'post_live') continue;
    const rawTitle = str(e.title);
    if (!rawTitle) continue;
    const rawChannel = str(e.channel) || str(e.uploader);
    const channel = channelName(rawChannel);
    const split = splitArtistTitle(rawTitle);
    const track: Track = {
      id: makeTrackId('youtube', id),
      source: 'youtube',
      sourceId: id,
      title: split ? split.title : rawTitle,
      artist: split ? split.artist : channel || UNKNOWN_ARTIST,
      downloadable: true,
      pageUrl: watchUrl(id),
    };
    if (typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration > 0) track.durationSec = Math.round(e.duration);
    track.coverUrl = pickCover(id, e.thumbnails);
    if (TOPIC_CHANNEL.test(rawChannel) || OFFICIAL_AUDIO_TITLE.test(rawTitle)) track.official = true;
    seen.add(id);
    out.push(track);
  }
  return out;
}

const isPlayableAudio = (f: Record<string, unknown>): boolean =>
  str(f.url).startsWith('https://') && str(f.protocol) === 'https' && str(f.acodec) !== 'none' && str(f.acodec) !== '';

/** Как в STREAM_FORMAT: сначала webm/opus, потом m4a. */
const STREAM_EXT_RANK: Record<string, number> = { webm: 0, m4a: 1 };

/** Прямой https-URL аудио из ответа `-j` (выбранный формат, иначе лучший: webm, затем m4a, по битрейту). */
export function parseYtStream(json: unknown): string {
  if (isObject(json)) {
    if (isPlayableAudio(json) && (str(json.vcodec) === 'none' || !json.vcodec)) return str(json.url);
    const formats = Array.isArray(json.formats) ? json.formats.filter(isObject) : [];
    const audio = formats
      .filter((f) => isPlayableAudio(f) && str(f.vcodec) === 'none' && str(f.ext) in STREAM_EXT_RANK)
      .sort((a, b) => STREAM_EXT_RANK[str(a.ext)] - STREAM_EXT_RANK[str(b.ext)] || (Number(b.abr) || 0) - (Number(a.abr) || 0));
    if (audio[0]) return str(audio[0].url);
  }
  throw new SourceError('unavailable', 'Для этого видео нет звука, который можно воспроизвести');
}

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === 'AbortError';

/** Ошибку yt-dlp превращает в состояние источника с понятным текстом. Отмена пробрасывается как есть. */
export function classifyYtDlpError(err: unknown): SourceError {
  if (isAbort(err)) throw err;
  if (err instanceof SourceError) return err;
  if (!(err instanceof YtDlpError)) return new SourceError('unknown', 'YouTube не ответил — попробуй ещё раз');
  if (err.kind === 'install' || err.kind === 'forbidden') return new SourceError('unavailable', err.message);
  if (err.kind === 'timeout') return new SourceError('unavailable', YT_SLOW_MESSAGE);
  const text = `${err.message}\n${err.stderr}`;
  if (/getaddrinfo|Errno 11001|Errno 11002|Name or service not known|No address associated|Failed to resolve|network is unreachable|Errno 1006[45]|Errno 10051/i.test(text)) {
    return new SourceError('offline', 'Нет соединения с YouTube');
  }
  if (/confirm your age|age[- ]restricted|inappropriate for some users/i.test(text)) {
    return new SourceError('unavailable', 'Видео с возрастным ограничением — без входа в аккаунт его не открыть');
  }
  if (/not a bot|HTTP Error 429|Too Many Requests/i.test(text)) {
    return new SourceError('unavailable', 'YouTube временно ограничил запросы без входа — попробуй позже');
  }
  if (/Private video|Video unavailable|video is unavailable|This video is not available|has been removed|members[- ]only|Join this channel|not available in your country|blocked it in your country/i.test(text)) {
    return new SourceError('unavailable', 'Видео недоступно');
  }
  if (/live event|is live|Premieres in|This live stream/i.test(text)) {
    return new SourceError('unavailable', 'Трансляции не поддерживаются');
  }
  if (/Requested format is not available/i.test(text)) {
    return new SourceError('unavailable', 'Для этого видео нет звука, который можно воспроизвести');
  }
  if (/timed out|TimeoutError|Connection reset|Errno 1005[34]|Errno 10060|Remote end closed|IncompleteRead|Connection aborted|SSL|EOF occurred/i.test(text)) {
    return new SourceError('unavailable', YT_SLOW_MESSAGE);
  }
  if (/HTTP Error 5\d\d|Service Unavailable/i.test(text)) {
    return new SourceError('unavailable', 'YouTube временно не отдаёт этот трек — попробуй позже');
  }
  if (/HTTP Error 403|nsig|n challenge|signature|Unable to extract|Please report this issue|latest version|--update|-U\b/i.test(text)) {
    return new SourceError('unavailable', YT_OUTDATED_MESSAGE);
  }
  return new SourceError('unknown', 'YouTube не ответил — попробуй ещё раз');
}

/** Сетевой сбой или тайм-аут: второй запуск с другим клиентом ответит так же медленно. */
const isNetworkError = (e: SourceError): boolean => e.kind === 'offline' || e.message === YT_SLOW_MESSAGE;

/** id видео из строки ошибки yt-dlp `ERROR: [youtube] <id>: …`. */
function failedVideoId(err: unknown): string | null {
  if (!(err instanceof YtDlpError)) return null;
  const m = /ERROR: \[youtube\] ([A-Za-z0-9_-]{11}):/.exec(`${err.message}\n${err.stderr}`);
  return m ? m[1] : null;
}

/**
 * Запуск yt-dlp, у которого нужна первая строка-JSON (`-j` с `--max-downloads 1`): код выхода 101 («достигнут
 * предел») и ошибки отдельных кандидатов (`-i`) не мешают, если JSON напечатан. Нет JSON — `error` (или null).
 */
export async function runForFirstJson(
  run: RunYtDlp,
  args: string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ json: Record<string, unknown> | null; error: unknown }> {
  let json: Record<string, unknown> | null = null;
  const onLine = (line: string) => {
    const t = line.trim();
    if (json || !t.startsWith('{')) return;
    try {
      const v: unknown = JSON.parse(t);
      if (isObject(v)) json = v;
    } catch {
      /* не JSON — служебная строка */
    }
  };
  try {
    const { stdout } = await run(args, signal, { timeoutMs, onLine });
    // Подмена запуска в тестах может не звать onLine: разбираем и итоговый вывод.
    if (!json) stdout.split(/\r?\n/).forEach(onLine);
    return { json, error: null };
  } catch (err) {
    if (isAbort(err)) throw err;
    return json ? { json, error: null } : { json: null, error: err };
  }
}

export interface YtStreamHit {
  videoId: string;
  title: string;
  channel: string;
  description: string;
  durationSec?: number;
  /** Ссылка на звук; null — кандидат найден, но быстрый клиент не дал звука (звук — через адаптер). */
  url: string | null;
  /** До какого времени ссылка годится. */
  until: number;
}

/** Кандидатов поиска: первый подходящий под фильтры и есть ответ. */
const COMBINED_CANDIDATES = 5;
const COMBINED_TIMEOUT_MS = 60_000;

/**
 * Поиск видео и ссылка на звук одним запуском yt-dlp: `ytsearch5:` без плоского режима, кандидаты отсеиваются
 * `--match-filter` (несколько фильтров — «или») по данным выдачи ещё до разбора видео, разбирается только первый
 * подошедший (`--max-downloads 1`), быстрым клиентом. Несколько запросов — по очереди в том же запуске,
 * до первого подошедшего. Ничего не подошло — null.
 */
export async function searchYtStream(
  run: RunYtDlp,
  query: string | readonly string[],
  filters: readonly string[],
  opts: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<YtStreamHit | null> {
  const args = [
    '-f',
    STREAM_FORMAT,
    '-j',
    '--max-downloads',
    '1',
    ...YT_FAST_CLIENT_ARGS,
    ...filters.flatMap((f) => ['--match-filter', f]),
    '--',
    ...(typeof query === 'string' ? [query] : query).map((q) => `ytsearch${COMBINED_CANDIDATES}:${q}`),
  ];
  const { json, error } = await runForFirstJson(run, args, opts.signal, opts.timeoutMs ?? COMBINED_TIMEOUT_MS);
  if (!json) {
    if (!error) return null;
    const classified = classifyYtDlpError(error);
    const id = failedVideoId(error);
    // Кандидат подошёл, но без звука для быстрого клиента: его id годится, звук возьмёт адаптер.
    if (id && !isNetworkError(classified)) return { videoId: id, title: '', channel: '', description: '', url: null, until: 0 };
    throw classified;
  }
  const videoId = str(json.id);
  if (!VIDEO_ID.test(videoId)) return null;
  let url: string | null = null;
  try {
    url = parseYtStream(json);
  } catch {
    url = null;
  }
  const now = (opts.now ?? Date.now)();
  const hit: YtStreamHit = {
    videoId,
    title: str(json.title),
    channel: str(json.channel) || str(json.uploader),
    description: str(json.description),
    url,
    until: url ? streamExpiry(url, now) : 0,
  };
  if (typeof json.duration === 'number' && json.duration > 0) hit.durationSec = Math.round(json.duration);
  return hit;
}

function videoIdOf(track: Track): string {
  if (track.source !== 'youtube' || !VIDEO_ID.test(track.sourceId)) throw new SourceError('unavailable', 'Неверный трек YouTube');
  return track.sourceId;
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new SourceError('unavailable', YT_OUTDATED_MESSAGE);
  }
}

/** Срок жизни ссылки из параметра `expire` (секунды), не дольше STREAM_CACHE_MS. */
export function streamExpiry(url: string, now: number): number {
  let expire = 0;
  try {
    expire = Number(new URL(url).searchParams.get('expire')) * 1000;
  } catch {
    /* без параметра */
  }
  const cap = now + STREAM_CACHE_MS;
  return expire > now ? Math.min(cap, expire - 10 * 60_000) : cap;
}

/** Строка прогресса `[aura] <скачано> <всего> <оценка>` → 0..1 (-1 — неизвестно) или null. */
function parseProgress(line: string): number | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  const [done, total, estimate] = line.slice(PROGRESS_PREFIX.length).trim().split(/\s+/).map(Number);
  const whole = Number.isFinite(total) && total > 0 ? total : Number.isFinite(estimate) && estimate > 0 ? estimate : 0;
  if (!Number.isFinite(done) || !whole) return -1;
  return Math.max(0, Math.min(1, done / whole));
}

/** Файлы, которые yt-dlp создал для этой загрузки: все начинаются с имени `*.part`, полученного от очереди. */
async function filesWithPrefix(dir: string, prefix: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.startsWith(prefix)).map((n) => join(dir, n));
  } catch {
    return [];
  }
}

async function removeWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await unlink(path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') return;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

const TEMP_FILE = /\.(part|ytdl|temp)(\.|$)|\.part-Frag\d+/i;


/**
 * Скачивание через yt-dlp в `<destPath>.<ext>` без перекодирования: `formats` пробуются по очереди —
 * следующий, только если загрузка прошлого оборвалась (HTTP 403/5xx). Прогресс — 0..1 (-1 — неизвестно).
 * Ошибка или отмена — все файлы этой загрузки удаляются; ошибка проходит через `classify`.
 */
export async function downloadWithYtDlp(
  run: RunYtDlp,
  url: string,
  destPath: string,
  formats: readonly string[],
  onProgress: (p: number) => void,
  signal: AbortSignal,
  classify: (err: unknown) => SourceError,
): Promise<string> {
  const dir = dirname(destPath);
  const prefix = basename(destPath);
  const cleanup = async () => {
    for (const p of await filesWithPrefix(dir, prefix)) await removeWithRetry(p);
  };
  const attempt = (format: string) =>
    run(
      [
        '-f',
        format,
        '--no-playlist',
        '--no-mtime',
        '--no-continue',
        '--retries',
        '3',
        '--fragment-retries',
        '3',
        '--newline',
        '--progress-template',
        `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
        // Имя от очереди + расширение, которое выберет yt-dlp; «%» в имени — литерал шаблона.
        '-o',
        `${destPath.replace(/%/g, '%%')}.%(ext)s`,
        '--',
        url,
      ],
      signal,
      {
        onLine: (line) => {
          const p = parseProgress(line);
          if (p !== null) onProgress(p);
        },
      },
    );
  try {
    for (let i = 0; i < formats.length; i++) {
      try {
        await attempt(formats[i]);
        break;
      } catch (err) {
        const last = i === formats.length - 1;
        const retryable = err instanceof YtDlpError && DOWNLOAD_RETRYABLE.test(`${err.message}\n${err.stderr}`);
        if (last || isAbort(err) || !retryable) throw err;
        await cleanup();
        onProgress(-1);
      }
    }
    const done = (await filesWithPrefix(dir, prefix)).filter((p) => !TEMP_FILE.test(basename(p).slice(prefix.length)));
    if (!done[0]) throw new SourceError('unavailable', 'yt-dlp не сохранил файл');
    onProgress(1);
    return done[0];
  } catch (err) {
    await cleanup();
    if (isAbort(err)) throw err;
    throw classify(err);
  }
}

/** Проверка ссылки: сервер должен отдать первые байты, а не 403/503 или тишину. */
const PROBE_TIMEOUT_MS = 8_000;
export const YT_NO_SOUND_MESSAGE = 'YouTube не отдаёт звук этого видео — попробуй позже';

/** Отдаёт ли ссылка звук: первые два байта за разумное время (ответ 200/206). Отмена пробрасывается. */
export async function probeStream(url: string, signal?: AbortSignal): Promise<boolean> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    await res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

export type ProbeStream = (url: string, signal?: AbortSignal) => Promise<boolean>;

export function createYoutubeAdapter(run: RunYtDlp = runYtDlp, now: () => number = Date.now, probe: ProbeStream = probeStream): SourceAdapter {
  const streams = new Map<string, { url: string; until: number }>();

  return {
    id: 'youtube',

    async search(query) {
      try {
        const { stdout } = await run(['--flat-playlist', '-J', '--', `ytsearch${SEARCH_LIMIT}:${query}`], undefined, {
          timeoutMs: SEARCH_TIMEOUT_MS,
        });
        // Интервью, миксы и ролики на часы — не треки (G26, G27).
        return parseYtSearch(parseJson(stdout)).filter(isLikelyTrack);
      } catch (err) {
        throw classifyYtDlpError(err);
      }
    },

    /** `opts.verify` (проверка звука волной): ссылка проверяется запросом первых байт; не отдаёт — другой клиент. */
    async resolveStream(track, _ctx, opts?: AdapterStreamOptions) {
      const id = videoIdOf(track);
      const cached = streams.get(id);
      if (cached && cached.until > now() && !opts?.fresh) {
        if (!opts?.verify || (await probe(cached.url, opts.signal))) return cached.url;
        streams.delete(id);
      }
      const attempt = async (client: readonly string[]) => {
        const { stdout } = await run(['-f', STREAM_FORMAT, '-j', '--no-playlist', ...client, '--', watchUrl(id)], opts?.signal, {
          timeoutMs: STREAM_TIMEOUT_MS,
        });
        const url = parseYtStream(parseJson(stdout));
        if (opts?.verify && !(await probe(url, opts.signal))) throw new SourceError('unavailable', YT_NO_SOUND_MESSAGE);
        return url;
      };
      let url: string;
      try {
        // Повтор плеера (ссылка быстрого клиента не заиграла) — сразу клиенты по умолчанию.
        if (opts?.fresh) url = await attempt(YT_DEFAULT_CLIENT_ARGS);
        else {
          try {
            url = await attempt(YT_FAST_CLIENT_ARGS);
          } catch (err) {
            const e = classifyYtDlpError(err);
            if (isNetworkError(e)) throw e;
            url = await attempt(YT_DEFAULT_CLIENT_ARGS);
          }
        }
      } catch (err) {
        throw classifyYtDlpError(err);
      }
      if (streams.size >= STREAM_CACHE_LIMIT) streams.delete(streams.keys().next().value!);
      streams.set(id, { url, until: streamExpiry(url, now()) });
      return url;
    },

    download(track, destPath, _ctx, onProgress, signal) {
      const id = videoIdOf(track);
      // YouTube иногда не отдаёт m4a (HTTP 5xx/403), а webm того же видео — отдаёт: берём его как есть.
      return downloadWithYtDlp(run, watchUrl(id), destPath, [DOWNLOAD_FORMAT, FALLBACK_DOWNLOAD_FORMAT], onProgress, signal, classifyYtDlpError);
    },
  };
}

export const youtube = createYoutubeAdapter();
