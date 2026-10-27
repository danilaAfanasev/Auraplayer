// SoundCloud через yt-dlp — строго анонимно (G01): без входа, куки и учётных данных (это гарантирует runYtDlp).
//
// Поиск — `scsearchN:` с плоским JSON. Крупные лейблы отдают анонимно только 30-секундный отрывок
// (форматы `*_preview`) или трек под DRM — такие в выдачу не попадают. Признаки (проверено в октябре 2026):
// - главный: ответ API поиска SoundCloud, который yt-dlp печатает по `--dump-pages` (тот же единственный
//   запрос, без лишних): `policy: SNIP` и `snipped: true` — отрывок; только `*-encrypted-hls` — DRM;
// - запасной (yt-dlp перестал печатать страницу): у отрывка в плоской выдаче длительность 30 с; DRM видно
//   только в полной информации трека — её запрашивают несколько параллельных yt-dlp с форматом «лучшее аудио,
//   но не отрывок»: что yt-dlp не смог выбрать, в выдачу не идёт. Это ~4 запроса на трек — SoundCloud
//   при частых поисках отвечает 403, поэтому только запасной путь.
//
// Поток — ссылка выбранного формата: прямой mp3 или HLS (AAC в fMP4), который <audio> в Electron играет сам.
// Скачивание — как есть, без перекодирования, через общий менеджер загрузок.
import { makeTrackId, type Track } from '../../shared/types';
import { runYtDlp, YtDlpError } from '../ytdlp';
import { SourceError, type AdapterStreamOptions, type SourceAdapter } from './types';
import { downloadWithYtDlp, runForFirstJson, splitArtistTitle, type RunYtDlp } from './youtube';

export const SC_SEARCH_LIMIT = 20;
/** Отрывок крупного лейбла — ровно 30 с; полный трек такой длины почти не встречается. */
export const PREVIEW_MAX_SEC = 31;
/** Сколько yt-dlp параллельно проверяют выдачу (каждый — свою часть). */
const CHECK_PROCESSES = 4;
const SEARCH_TIMEOUT_MS = 45_000;
const CHECK_TIMEOUT_MS = 45_000;
/** Поток: плеер ждёт без таймера, зависший yt-dlp всё же обрываем. */
const STREAM_TIMEOUT_MS = 90_000;
/** Ссылки SoundCloud живут несколько часов; держим не дольше часа. */
const STREAM_CACHE_MS = 60 * 60_000;
const STREAM_CACHE_LIMIT = 200;

/** «Лучшее аудио, но не отрывок»: у отрывков id формата оканчивается на `_preview`. */
const NOT_PREVIEW = '[format_id!*=preview]';
/** Поток: без opus (HLS с opus Chromium может не открыть), иначе любое полное аудио. */
const STREAM_FORMAT = `bestaudio${NOT_PREVIEW}[acodec!=opus]/bestaudio${NOT_PREVIEW}`;
/** Проверка в поиске — тот же выбор, что у потока: прошёл проверку — заиграет. */
const CHECK_FORMAT = STREAM_FORMAT;
/** Скачивание: сначала прямой файл (mp3), иначе HLS — фрагменты склеиваются в m4a как есть. */
const DOWNLOAD_FORMAT = `bestaudio${NOT_PREVIEW}[protocol=http]/bestaudio${NOT_PREVIEW}`;
/** Метка строк проверки в выводе yt-dlp. */
const CHECK_PREFIX = '[aura-sc]';

export const SC_PREVIEW_MESSAGE = 'На SoundCloud у этого трека только 30-секундный отрывок';
const SC_DRM_MESSAGE = 'Трек защищён правообладателем — SoundCloud не отдаёт его без входа';
const SC_SLOW_MESSAGE = 'SoundCloud не отвечает. В России без VPN он может работать медленно или не работать';
const SC_UNKNOWN_MESSAGE = 'SoundCloud не ответил — попробуй ещё раз';
/** HTTP 403: SoundCloud отказывает анонимным запросам, обычно — после частых поисков. */
export const SC_FORBIDDEN_MESSAGE = 'SoundCloud временно отказывает в запросах — попробуй через несколько минут';

const TRACK_ID = /^\d{1,20}$/;
const COVER_SIZES = ['t500x500', 'crop', 't300x300', 'large'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === 'AbortError';

/** Адрес трека в API SoundCloud — по нему yt-dlp открывает трек без лишнего запроса страницы. */
export const scApiUrl = (id: string): string => `https://api.soundcloud.com/tracks/${id}`;

function pickCover(thumbnails: unknown): string | undefined {
  if (!Array.isArray(thumbnails)) return undefined;
  const list = thumbnails.filter(isObject);
  for (const size of COVER_SIZES) {
    const url = str(list.find((t) => t.id === size)?.url);
    if (url.startsWith('https://')) return url;
  }
  return undefined;
}

/**
 * Треки из плоского JSON `scsearchN:` (`--flat-playlist -J`). Плейлисты и пользователи пропускаются,
 * отрывки (длительность до 31 с) — тоже. DRM-треки здесь ещё не отличить — их отсеивает проверка адаптера.
 */
export function parseScSearch(json: unknown): Track[] {
  if (!isObject(json) || !Array.isArray(json.entries)) return [];
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const e of json.entries) {
    if (!isObject(e)) continue;
    const id = str(e.id);
    if (!TRACK_ID.test(id) || seen.has(id)) continue;
    if (e.ie_key !== undefined && e.ie_key !== 'Soundcloud') continue;
    const rawTitle = str(e.title);
    if (!rawTitle) continue;
    const duration = typeof e.duration === 'number' && Number.isFinite(e.duration) ? e.duration : 0;
    if (duration > 0 && duration <= PREVIEW_MAX_SEC) continue;
    const uploader = str(e.uploader) || (Array.isArray(e.artists) ? str(e.artists[0]) : '') || 'SoundCloud';
    const split = splitArtistTitle(rawTitle);
    const track: Track = {
      id: makeTrackId('soundcloud', id),
      source: 'soundcloud',
      sourceId: id,
      title: split ? split.title : rawTitle,
      artist: split ? split.artist : uploader,
      downloadable: true,
    };
    if (duration > 0) track.durationSec = Math.round(duration);
    const cover = pickCover(e.thumbnails);
    if (cover) track.coverUrl = cover;
    const page = str(e.webpage_url);
    if (page.startsWith('https://soundcloud.com/')) track.pageUrl = page;
    seen.add(id);
    out.push(track);
  }
  return out;
}

/** Можно ли слушать транскодинг без входа: полный (не отрывок), не зашифрован, AAC или MP3. */
function isOpenTranscoding(t: unknown): boolean {
  if (!isObject(t) || t.snipped === true) return false;
  const protocol = isObject(t.format) ? str(t.format.protocol) : '';
  return (protocol === 'hls' || protocol === 'progressive') && /^(aac|mp3)/i.test(str(t.preset));
}

/**
 * Доступ к трекам по ответу API поиска SoundCloud (`{collection: [...]}`): id → можно ли слушать целиком
 * без входа. Нет — отрывок (`policy: SNIP`), запрет (`BLOCK`) или только зашифрованные потоки (DRM).
 */
export function parseScAccess(page: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!isObject(page) || !Array.isArray(page.collection)) return out;
  for (const t of page.collection) {
    if (!isObject(t)) continue;
    const id = apiTrackId(t);
    if (!TRACK_ID.test(id) || !isObject(t.media) || !Array.isArray(t.media.transcodings)) continue;
    out.set(id, isOpenApiTrack(t));
  }
  return out;
}

const apiTrackId = (t: Record<string, unknown>): string => (typeof t.id === 'number' && Number.isFinite(t.id) ? String(t.id) : str(t.id));

/** Трек из ответа API можно слушать целиком без входа: не отрывок, не запрет, есть открытый (не DRM) поток. */
function isOpenApiTrack(t: Record<string, unknown>): boolean {
  if (!isObject(t.media) || !Array.isArray(t.media.transcodings)) return false;
  const policy = str(t.policy).toUpperCase();
  return policy !== 'SNIP' && policy !== 'BLOCK' && t.streamable !== false && t.media.transcodings.some(isOpenTranscoding);
}

/** Обложка API (`…-large.jpg`, 100×100) в размере 500×500. */
function apiCover(url: string): string | undefined {
  if (!url.startsWith('https://')) return undefined;
  return url.replace(/-large(\.\w+)$/, '-t500x500$1');
}

/**
 * Треки из ответов API SoundCloud, которые yt-dlp печатает по `--dump-pages`: массив (`tracks?ids=` чарта)
 * или страница `{collection}` (рекомендации). В список идут только полные треки без входа — отрывки и DRM
 * отсеиваются по тем же признакам, что и в поиске; заглушки плейлиста (только id) пропускаются.
 * Жанр трека — в `tags` (по нему «Свежее» делится на жанры).
 */
export function parseScApiTracks(data: unknown): Track[] {
  const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.collection) ? data.collection : [];
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    if (!isObject(t) || (t.kind !== undefined && t.kind !== 'track')) continue;
    const id = apiTrackId(t);
    const rawTitle = str(t.title);
    if (!TRACK_ID.test(id) || seen.has(id) || !rawTitle || !isOpenApiTrack(t)) continue;
    const durationMs = typeof t.duration === 'number' && Number.isFinite(t.duration) ? t.duration : 0;
    if (durationMs > 0 && durationMs <= PREVIEW_MAX_SEC * 1000) continue;
    const publisher = isObject(t.publisher_metadata) ? str(t.publisher_metadata.artist) : '';
    const uploader = isObject(t.user) ? str(t.user.username) : '';
    const split = splitArtistTitle(rawTitle);
    const track: Track = {
      id: makeTrackId('soundcloud', id),
      source: 'soundcloud',
      sourceId: id,
      title: split ? split.title : rawTitle,
      // «Исполнитель - Название» делится, как в поиске; иначе исполнитель — из данных издателя, потом автор загрузки.
      artist: split ? split.artist : publisher || uploader || 'SoundCloud',
      downloadable: true,
    };
    if (durationMs > 0) track.durationSec = Math.round(durationMs / 1000);
    const cover = apiCover(str(t.artwork_url)) ?? (isObject(t.user) ? apiCover(str(t.user.avatar_url)) : undefined);
    if (cover) track.coverUrl = cover;
    const page = str(t.permalink_url);
    if (page.startsWith('https://soundcloud.com/')) track.pageUrl = page;
    const genre = str(t.genre);
    if (genre) track.tags = [genre];
    seen.add(id);
    out.push(track);
  }
  return out;
}

/** Ответы API, которые yt-dlp напечатал по `--dump-pages`: для запросов, чей адрес подходит под `url`. */
export function readDumpedPages(stdout: string, url: RegExp): unknown[] {
  const lines = stdout.split(/\r?\n/);
  const pages: unknown[] = [];
  lines.forEach((line, i) => {
    const m = /Dumping request to (\S+)/.exec(line);
    if (!m || !url.test(m[1])) return;
    try {
      pages.push(JSON.parse(Buffer.from(lines[i + 1]?.trim() ?? '', 'base64').toString('utf8')));
    } catch {
      /* страница не разобралась */
    }
  });
  return pages;
}

/**
 * Вывод `-J --no-quiet --dump-pages`: JSON выдачи (последняя строка-объект) и страницы ответа API поиска
 * (строка base64 после «Dumping request to …/search/…»).
 */
export function readSearchOutput(stdout: string): { json: unknown; pages: unknown[] } {
  const lines = stdout.split(/\r?\n/);
  const pages: unknown[] = [];
  lines.forEach((line, i) => {
    if (!/Dumping request to https:\/\/api[-\w]*\.soundcloud\.com\/search\//.test(line)) return;
    try {
      pages.push(JSON.parse(Buffer.from(lines[i + 1]?.trim() ?? '', 'base64').toString('utf8')));
    } catch {
      /* страница не разобралась — останется запасная проверка */
    }
  });
  const last = [...lines].reverse().find((l) => l.trim().startsWith('{'));
  return { json: last === undefined ? null : parseJson(last), pages };
}

/** Ссылка на звук из ответа `-j`: выбранный формат; отрывок вместо трека — ошибка. */
export function parseScStream(json: unknown): string {
  if (isObject(json)) {
    if (/preview/i.test(str(json.format_id))) throw new SourceError('unavailable', SC_PREVIEW_MESSAGE);
    const url = str(json.url);
    if (url.startsWith('https://')) return url;
  }
  throw new SourceError('unavailable', 'Для этого трека нет звука, который можно воспроизвести');
}

/** Ошибку yt-dlp превращает в состояние источника с понятным текстом. Отмена пробрасывается как есть. */
export function classifyScError(err: unknown): SourceError {
  if (isAbort(err)) throw err;
  if (err instanceof SourceError) return err;
  if (!(err instanceof YtDlpError)) return new SourceError('unknown', SC_UNKNOWN_MESSAGE);
  if (err.kind === 'install' || err.kind === 'forbidden') return new SourceError('unavailable', err.message);
  if (err.kind === 'timeout') return new SourceError('unavailable', SC_SLOW_MESSAGE);
  const text = `${err.message}\n${err.stderr}`;
  if (/getaddrinfo|Errno 11001|Errno 11002|Name or service not known|No address associated|Failed to resolve|network is unreachable|Errno 1006[45]|Errno 10051/i.test(text)) {
    return new SourceError('offline', 'Нет соединения с SoundCloud');
  }
  if (/DRM protected/i.test(text)) return new SourceError('unavailable', SC_DRM_MESSAGE);
  if (/Requested format is not available|preview/i.test(text)) return new SourceError('unavailable', SC_PREVIEW_MESSAGE);
  if (/HTTP Error 404|Not Found|not available in your country|geo restrict/i.test(text)) {
    return new SourceError('unavailable', 'Трек недоступен на SoundCloud');
  }
  if (/HTTP Error 403/i.test(text)) return new SourceError('unavailable', SC_FORBIDDEN_MESSAGE);
  if (/HTTP Error 429|Too Many Requests/i.test(text)) {
    return new SourceError('unavailable', 'SoundCloud временно ограничил запросы — попробуй позже');
  }
  if (/timed out|TimeoutError|Connection reset|Errno 1005[34]|Errno 10060|Remote end closed|IncompleteRead|Connection aborted|SSL|EOF occurred|HTTP Error 5\d\d/i.test(text)) {
    return new SourceError('unavailable', SC_SLOW_MESSAGE);
  }
  if (/Unable to extract|client_id|HTTP Error 401|Please report this issue|latest version/i.test(text)) {
    return new SourceError('unavailable', 'SoundCloud изменился — обнови yt-dlp в настройках (раздел YouTube)');
  }
  return new SourceError('unknown', SC_UNKNOWN_MESSAGE);
}

/** SoundCloud недоступен, а не просто медленный: нет сети или ответ 403 (ошибка — после `classifyScError`). */
export function isScUnreachable(err: unknown): boolean {
  return err instanceof SourceError && (err.kind === 'offline' || err.message === SC_FORBIDDEN_MESSAGE);
}

function trackIdOf(track: Track): string {
  if (track.source !== 'soundcloud' || !TRACK_ID.test(track.sourceId)) throw new SourceError('unavailable', 'Неверный трек SoundCloud');
  return track.sourceId;
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new SourceError('unavailable', 'SoundCloud изменился — обнови yt-dlp в настройках (раздел YouTube)');
  }
}

/** Срок жизни ссылки из параметра `expires` (секунды), не дольше STREAM_CACHE_MS. */
function streamExpiry(url: string, now: number): number {
  let expire = 0;
  try {
    const params = new URL(url).searchParams;
    expire = Number(params.get('expires') ?? params.get('Expires')) * 1000;
  } catch {
    /* без параметра */
  }
  const cap = now + STREAM_CACHE_MS;
  return expire > now ? Math.min(cap, expire - 10 * 60_000) : cap;
}

export interface ScStreamHit {
  /** Найденный трек SoundCloud (метаданные SoundCloud). */
  track: Track;
  url: string;
  /** До какого времени ссылка годится. */
  until: number;
}

/** Кандидатов поиска полной версии. */
const MATCH_CANDIDATES = 8;
const MATCH_TIMEOUT_MS = 30_000;

/**
 * Поиск трека и ссылка на звук одним запуском yt-dlp: `scsearch8:`, кандидаты отсеиваются `--match-filter`
 * (несколько фильтров — «или») по данным выдачи, разбирается первый подошедший (`--max-downloads 1`).
 * Отрывок или DRM не дают выбрать формат «не отрывок» — такой кандидат пропускается (`-i`), берётся следующий.
 * Ничего не подошло — null. Готово для любого «найди это на SoundCloud» (каталог, волна, раздел SoundCloud).
 */
export async function searchScStream(
  run: RunYtDlp,
  query: string,
  filters: readonly string[],
  opts: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<ScStreamHit | null> {
  const args = [
    '-f',
    STREAM_FORMAT,
    '-j',
    '-i',
    '--max-downloads',
    '1',
    ...filters.flatMap((f) => ['--match-filter', f]),
    '--',
    `scsearch${MATCH_CANDIDATES}:${query}`,
  ];
  const { json, error } = await runForFirstJson(run, args, opts.signal, opts.timeoutMs ?? MATCH_TIMEOUT_MS);
  if (!json) {
    if (!error) return null;
    const e = classifyScError(error);
    // Все подошедшие оказались отрывками или под DRM — «не нашлось», а не сбой.
    if (e.message === SC_DRM_MESSAGE || e.message === SC_PREVIEW_MESSAGE || e.message === 'Трек недоступен на SoundCloud') return null;
    throw e;
  }
  const [track] = parseScSearch({ entries: [json] });
  if (!track) return null;
  let url: string;
  try {
    url = parseScStream(json);
  } catch {
    return null;
  }
  return { track, url, until: streamExpiry(url, (opts.now ?? Date.now)()) };
}

const LIST_TIMEOUT_MS = 45_000;
/** Рекомендаций к треку за один запрос (SoundCloud отдаёт до 50 на странице). */
const RECOMMENDED_LIMIT = 50;
/**
 * Плейлист по id API с параметром `secret_token` — тогда yt-dlp запрашивает все треки плейлиста одним
 * запросом `tracks?ids=` (без него в ответе SoundCloud полные данные только у первых пяти). Публичному
 * плейлисту значение параметра не важно; это не вход и не учётные данные (G01).
 */
const PLAYLIST_TOKEN = 'aura';
const PAGE_URL = /^https:\/\/soundcloud\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

/** Адрес плейлиста в API, по которому yt-dlp получает все его треки одним запросом. */
export const scPlaylistApiUrl = (id: string): string => `https://api-v2.soundcloud.com/playlists/${id}?secret_token=${PLAYLIST_TOKEN}`;

async function runForPages(run: RunYtDlp, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await run(['--flat-playlist', '-J', '--no-quiet', '--dump-pages', ...args], signal, { timeoutMs: LIST_TIMEOUT_MS });
    return stdout;
  } catch (err) {
    throw classifyScError(err);
  }
}

/**
 * Плейлист SoundCloud (например, чарт) одним запуском yt-dlp: полные треки без отрывков и DRM, в порядке плейлиста.
 * Данные треков — из ответов SoundCloud (`--dump-pages`): `tracks?ids=` со всеми треками, иначе сам плейлист.
 */
export async function fetchScPlaylist(run: RunYtDlp, playlistId: string, opts: { signal?: AbortSignal } = {}): Promise<ScPlaylist> {
  if (!TRACK_ID.test(playlistId)) throw new SourceError('unavailable', 'Неверный плейлист SoundCloud');
  const stdout = await runForPages(run, ['--', scPlaylistApiUrl(playlistId)], opts.signal);
  const [playlist] = readDumpedPages(stdout, new RegExp(`/playlists/${playlistId}(\\?|$)`));
  const pages = readDumpedPages(stdout, /\/tracks\?ids=/);
  const sources: unknown[] = pages.length > 0 ? pages : isObject(playlist) ? [playlist.tracks] : [];
  const all = sources.flatMap((p) => parseScApiTracks(p));
  const order = isObject(playlist) && Array.isArray(playlist.tracks) ? playlist.tracks.filter(isObject).map(apiTrackId) : [];
  const pos = (t: Track): number => {
    const i = order.indexOf(t.sourceId);
    return i < 0 ? order.length : i;
  };
  const tracks = all.map((t, i) => ({ t, i })).sort((a, b) => pos(a.t) - pos(b.t) || a.i - b.i).map(({ t }) => t);
  return { tracks, ...parseScStats(sources) };
}

/** Поиск со статистикой: результатов за запуск. */
const SEARCH_STATS_LIMIT = 50;

/**
 * Поиск SoundCloud одним запуском yt-dlp (`scsearch50:`) с данными из ответа API поиска: полные треки
 * (без отрывков и DRM), число прослушиваний и дата загрузки — для «популярного в России», где чарта нет.
 */
export async function fetchScSearch(run: RunYtDlp, query: string, opts: { signal?: AbortSignal } = {}): Promise<ScPlaylist> {
  const stdout = await runForPages(run, ['--', `scsearch${SEARCH_STATS_LIMIT}:${query}`], opts.signal);
  const pages = readDumpedPages(stdout, /\/search\//);
  const seen = new Set<string>();
  const tracks = pages.flatMap((p) => parseScApiTracks(p)).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  return { tracks, ...parseScStats(pages) };
}

export interface ScPlaylist {
  /** Полные треки (без отрывков и DRM) в порядке плейлиста или выдачи. */
  tracks: Track[];
  /** Когда трек загружен на SoundCloud (мс), по id. */
  createdAt: Record<string, number>;
  /** Сколько раз трек прослушан, по id. */
  plays: Record<string, number>;
}

/** Даты загрузки (`created_at`) и прослушивания (`playback_count`) из ответов API (массив или `{collection}`), по id. */
function parseScStats(sources: unknown[]): Pick<ScPlaylist, 'createdAt' | 'plays'> {
  const createdAt: Record<string, number> = {};
  const plays: Record<string, number> = {};
  for (const data of sources) {
    const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.collection) ? data.collection : [];
    for (const t of list) {
      if (!isObject(t)) continue;
      const id = apiTrackId(t);
      if (!TRACK_ID.test(id)) continue;
      const at = Date.parse(str(t.created_at));
      if (Number.isFinite(at)) createdAt[id] = at;
      if (typeof t.playback_count === 'number' && Number.isFinite(t.playback_count)) plays[id] = t.playback_count;
    }
  }
  return { createdAt, plays };
}

/** Страница трека SoundCloud: из трека или (у старых снимков без неё) у yt-dlp по id. */
async function pageOf(run: RunYtDlp, track: Track, signal?: AbortSignal): Promise<string> {
  const known = (track.pageUrl ?? '').split(/[?#]/)[0].replace(/\/$/, '');
  if (PAGE_URL.test(known)) return known;
  let stdout = '';
  try {
    ({ stdout } = await run(
      ['--no-playlist', '--skip-download', '--ignore-no-formats-error', '--no-warnings', '--print', 'webpage_url', '--', scApiUrl(trackIdOf(track))],
      signal,
      { timeoutMs: LIST_TIMEOUT_MS },
    ));
  } catch (err) {
    throw classifyScError(err);
  }
  const page = stdout.split(/\r?\n/).map((l) => l.trim().split(/[?#]/)[0]).find((l) => PAGE_URL.test(l));
  if (!page) throw new SourceError('unavailable', 'Трек недоступен на SoundCloud');
  return page;
}

/**
 * Рекомендации SoundCloud к треку (`<страница трека>/recommended`, yt-dlp умеет сам): полные треки без отрывков
 * и DRM, в порядке SoundCloud, без самого трека.
 */
export async function fetchScRecommended(run: RunYtDlp, track: Track, opts: { signal?: AbortSignal } = {}): Promise<Track[]> {
  const id = trackIdOf(track);
  const page = await pageOf(run, track, opts.signal);
  const stdout = await runForPages(run, ['--playlist-end', String(RECOMMENDED_LIMIT), '--', `${page}/recommended`], opts.signal);
  return readDumpedPages(stdout, /\/tracks\/\d+\/related/)
    .flatMap((p) => parseScApiTracks(p))
    .filter((t) => t.sourceId !== id);
}

/** `list` на `parts` почти равных частей подряд (без пустых). */
function split<T>(list: T[], parts: number): T[][] {
  const size = Math.ceil(list.length / Math.max(1, parts));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function createSoundcloudAdapter(run: RunYtDlp = runYtDlp, now: () => number = Date.now): SourceAdapter {
  const streams = new Map<string, { url: string; until: number }>();

  /**
   * id треков, которые yt-dlp может отдать целиком. Один процесс на часть списка: ошибка отдельного трека
   * (`-i`) не мешает остальным, код выхода тогда ненулевой — ответ собирается из напечатанных строк.
   */
  async function playableIds(tracks: Track[]): Promise<Set<string>> {
    const ok = new Set<string>();
    const failures: unknown[] = [];
    await Promise.all(
      split(tracks, CHECK_PROCESSES).map(async (part) => {
        const args = ['-i', '--no-warnings', '--no-playlist', '-f', CHECK_FORMAT, '--print', `${CHECK_PREFIX}%(id)s`, '--'];
        let printed = 0;
        try {
          await run([...args, ...part.map((t) => scApiUrl(t.sourceId))], undefined, {
            timeoutMs: CHECK_TIMEOUT_MS,
            onLine: (line) => {
              const id = line.trim().startsWith(CHECK_PREFIX) ? line.trim().slice(CHECK_PREFIX.length).trim() : '';
              if (TRACK_ID.test(id)) {
                ok.add(id);
                printed++;
              }
            },
          });
        } catch (err) {
          // Ненулевой код при напечатанных треках — часть списка недоступна (DRM, отрывок), это нормально.
          if (printed === 0) failures.push(err);
        }
      }),
    );
    // Не прошла ни одна часть — сбой сети или yt-dlp, а не «всё недоступно».
    if (ok.size === 0 && failures.length > 0) {
      const errors = failures.map((e) => classifyScError(e));
      const real = errors.find((e) => e.kind === 'offline') ?? errors.find((e) => e.message !== SC_DRM_MESSAGE && e.message !== SC_PREVIEW_MESSAGE);
      if (real) throw real;
    }
    return ok;
  }

  return {
    id: 'soundcloud',

    async search(query) {
      try {
        const { stdout } = await run(
          ['--flat-playlist', '-J', '--no-quiet', '--dump-pages', '--', `scsearch${SC_SEARCH_LIMIT}:${query}`],
          undefined,
          { timeoutMs: SEARCH_TIMEOUT_MS },
        );
        const { json, pages } = readSearchOutput(stdout);
        const found = parseScSearch(json);
        if (found.length === 0) return [];
        const access = new Map(pages.flatMap((p) => [...parseScAccess(p)]));
        if (access.size > 0) return found.filter((t) => access.get(t.sourceId) === true);
        // yt-dlp не показал ответ SoundCloud — проверяем найденное по полной информации треков.
        const ok = await playableIds(found);
        return found.filter((t) => ok.has(t.sourceId));
      } catch (err) {
        throw classifyScError(err);
      }
    },

    async resolveStream(track, _ctx, opts?: AdapterStreamOptions) {
      const id = trackIdOf(track);
      const cached = streams.get(id);
      if (cached && cached.until > now() && !opts?.fresh) return cached.url;
      try {
        const { stdout } = await run(['-f', STREAM_FORMAT, '-j', '--no-playlist', '--', scApiUrl(id)], opts?.signal, {
          timeoutMs: STREAM_TIMEOUT_MS,
        });
        const url = parseScStream(parseJson(stdout));
        if (streams.size >= STREAM_CACHE_LIMIT) streams.delete(streams.keys().next().value!);
        streams.set(id, { url, until: streamExpiry(url, now()) });
        return url;
      } catch (err) {
        throw classifyScError(err);
      }
    },

    download(track, destPath, _ctx, onProgress, signal) {
      const id = trackIdOf(track);
      return downloadWithYtDlp(run, scApiUrl(id), destPath, [DOWNLOAD_FORMAT], onProgress, signal, classifyScError);
    },
  };
}

export const soundcloud = createSoundcloudAdapter();
