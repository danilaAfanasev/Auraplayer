// Волна: бесконечные похожие треки. Модуль не импортирует electron.
// Похожие на трек — YouTube Mix этого трека (`watch?v=<id>&list=RD<id>`, `runYtDlp --flat-playlist`, анонимно — G01).
// Похожие на артиста — его треки, радио похожих и популярное его «похожих артистов» (`artist/{id}/related`, без фильтра
// языка) из открытого API без ключа; жанр — подборки по запросу там же. Зарубежное похожее (G77): жанр исполнителя
// (жанр альбома его популярного трека) — английским запросом подборок, эти кандидаты вкраплены в список каждым пятым,
// долю (~20 %) держит и отборщик `shared/wave.ts`. Один исполнитель — не больше `MAX_PER_ARTIST` кандидатов за порцию.
// Такие треки — треки каталога (`catalog:dz<id>`): звук ищет адаптер каталога (SoundCloud, затем YouTube) по исполнителю,
// названию и длительности. Названия сервиса в интерфейсе нет. Отбор без дублей — `shared/wave.ts`, у рендерера.
// Волна SoundCloud (сиды — треки SoundCloud): похожие — рекомендации SoundCloud к треку (`<страница>/recommended`,
// yt-dlp анонимно), треки SoundCloud без отрывков и DRM; YouTube и открытый API для неё не нужны.
import type { WaveMoreRequest, WaveSeed } from '../shared/api';
import { isLikelyTrack } from '../shared/trackFilter';
import { makeTrackId, type Track } from '../shared/types';
import { artistNames, primaryArtist } from '../shared/wave';
import { DEEZER_BASE, parseDeezerArtists, pickDeezerArtist } from './sources/artists';
import { MATCHES_FILE, normalizeText, parseYtCandidates, pickYtCandidate, ytSearchQuery, type FetchJson } from './sources/catalog';
import { fetchJson as defaultFetchJson } from './sources/http';
import { fetchScRecommended } from './sources/soundcloud';
import { SourceError } from './sources/types';
import { classifyYtDlpError, parseYtSearch, type RunYtDlp } from './sources/youtube';
import { readJson } from './store';
import { runYtDlp } from './ytdlp';

/** Сколько видео брать из Mix: дальше YouTube повторяет те же (и yt-dlp листает его бесконечно). */
export const MIX_LENGTH = 40;
const MIX_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 60_000;
const API_TIMEOUT_MS = 15_000;
const RADIO_LIMIT = 40;
const TOP_LIMIT = 10;
/** Своих треков артиста в первой порции. */
const TOP_PER_ARTIST = 2;
/** Сидов-артистов в одной порции (остальные — в следующих): шире — больше разных исполнителей в окне 10. */
const ARTISTS_PER_BATCH = 5;
/** Запросов (жанров) в первой порции — не больше стольких: открытый API пускает ~50 запросов за 5 с. */
const QUERIES_PER_BATCH = 4;
/** Один исполнитель (основной) — не больше стольких кандидатов за порцию. */
export const MAX_PER_ARTIST = 3;
/** «Похожие артисты» источника: сколько из списка взять и сколько их популярных треков. */
const RELATED_LIMIT = 20;
const RELATED_ARTISTS = 2;
const RELATED_TOP = 5;
const RELATED_PER_ARTIST = 2;
/** Треков подборки жанра (зарубежное похожее) за порцию. */
const GENRE_TRACKS = 10;
/** Сколько подмешанных зарубежных треков помнить (не сиды дополнения). */
const SPICE_LIMIT = 2000;
/** Зарубежное похожее — каждый пятый кандидат. */
const FOREIGN_EVERY = 5;
const PLAYLISTS_PER_QUERY = 3;
const PLAYLIST_TRACKS = 100;
/** Похожие на сколько последних треков очереди ищутся при дополнении. */
const RECENT_FOR_MORE = 3;
const ARTIST_CACHE_MS = 24 * 60 * 60_000;

/** Песня длится не меньше минуты: короче — интро и скиты. Верхний предел и слова «интервью/микс/…» — `isLikelyTrack`. */
const MIN_SONG_SEC = 60;
/**
 * Переделки чужих треков и типбиты в нормализованном названии, окружённом пробелами (границы слов — пробелы:
 * `\b` в JS не видит кириллицу). Сборники, миксы, интервью и т. п. отсеивает `shared/trackFilter.ts`.
 */
const NOT_A_SONG = [
  / type beat /,
  // Переделки чужих треков: волна уходит от них в «slowed + reverb»-подборки, а не к похожей музыке.
  / (slowed|sped up|speed up|nightcore|reverb|instrumental|инструментал|karaoke|караоке|8d|bass boosted|boosted)( |$)/,
  / (ускоренн|замедленн)/,
  // Фонк-ремиксы и ремейки чужих треков (просто «Remix» исполнителя остаётся).
  / (phonk|фонк) (remix|ремикс) /,
  / (remake|ремейк) /,
];

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NEEDS_YOUTUBE_MESSAGE = 'Чтобы волна подбирала похожие треки, включи YouTube в настройках';
const NEEDS_SOUNDCLOUD_MESSAGE = 'Чтобы волна SoundCloud подбирала похожие треки, включи SoundCloud в настройках';
const NOTHING_FOUND_MESSAGE = 'Не удалось подобрать похожие треки — попробуй другую волну';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const idStr = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : /^\d+$/.test(str(v)) ? str(v) : '');
const enc = encodeURIComponent;

/** YouTube Mix видео: похожие треки, которые YouTube подбирает сам (без входа в аккаунт). */
export const mixUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;

/** Похоже на песню, а не на сборник, микс, интервью, скит или ускоренную/замедленную переделку. */
export function isSongLike(track: Pick<Track, 'title' | 'artist' | 'durationSec' | 'official'>): boolean {
  const d = track.durationSec;
  if (d !== undefined && d < MIN_SONG_SEC) return false;
  if (!isLikelyTrack(track)) return false;
  const title = ` ${normalizeText(track.title)} `;
  return !NOT_A_SONG.some((re) => re.test(title));
}

/** Треки из плоского JSON Mix (или поиска) YouTube: без нетрековых видео и без `excludeId` (сам сид). */
export function parseYtMix(json: unknown, excludeId?: string): Track[] {
  return parseYtSearch(json).filter((t) => t.sourceId !== excludeId && isSongLike(t));
}

/** Треки из ответа открытого API (`artist/{id}/radio|top`, `playlist/{id}/tracks`, `search`) — как треки каталога. */
export function parseDeezerTracks(json: unknown): Track[] {
  if (!isObject(json) || !Array.isArray(json.data)) return [];
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const r of json.data) {
    if (!isObject(r) || (r.type !== undefined && r.type !== 'track')) continue;
    const id = idStr(r.id);
    const title = str(r.title);
    const artist = isObject(r.artist) ? str(r.artist.name) : '';
    if (!id || !title || !artist || seen.has(id)) continue;
    seen.add(id);
    const sourceId = `dz${id}`;
    const track: Track = { id: makeTrackId('catalog', sourceId), source: 'catalog', sourceId, title, artist, downloadable: true };
    const album = isObject(r.album) ? r.album : null;
    if (album && str(album.title)) track.album = str(album.title);
    if (typeof r.duration === 'number' && r.duration > 0) track.durationSec = Math.round(r.duration);
    const cover = album ? str(album.cover_xl) || str(album.cover_big) : '';
    if (cover.startsWith('https://') && !cover.includes('/cover//')) track.coverUrl = cover;
    out.push(track);
  }
  return out;
}

/** Не больше `max` кандидатов от одного основного исполнителя, порядок сохраняется. */
export function capPerArtist(tracks: readonly Track[], max = MAX_PER_ARTIST): Track[] {
  const count = new Map<string, number>();
  return tracks.filter((t) => {
    const key = primaryArtist(t);
    const c = count.get(key) ?? 0;
    if (c >= max) return false;
    count.set(key, c + 1);
    return true;
  });
}

/**
 * Жанр открытого API («Rap/Hip Hop», «Pop», «Electro») → английский запрос подборок со свежим годом: «hip hop 2026».
 * Пустой или служебный («All») — null.
 */
export function genreQueryOf(genre: string, year: number): string | null {
  const name = genre.split('/').pop()?.trim().toLowerCase() ?? '';
  if (!name || name === 'all') return null;
  return `${name} ${year}`;
}

/** id альбома первого трека ответа (`artist/{id}/top`). */
function firstAlbumId(json: unknown): string {
  if (!isObject(json) || !Array.isArray(json.data)) return '';
  const first = json.data.find(isObject);
  return first && isObject(first.album) ? idStr(first.album.id) : '';
}

/** Жанр альбома (`album/{id}`): первый из `genres`. */
function albumGenre(json: unknown): string {
  if (!isObject(json) || !isObject(json.genres) || !Array.isArray(json.genres.data)) return '';
  const first = json.genres.data.find(isObject);
  return first ? str(first.name) : '';
}

/** Зарубежные кандидаты — каждым `every`-м в список (остаток — в конце): по письменности их не всегда отличить. */
export function sprinkle(main: readonly Track[], extra: readonly Track[], every = FOREIGN_EVERY): Track[] {
  const out: Track[] = [];
  let e = 0;
  main.forEach((t, i) => {
    out.push(t);
    if ((i + 1) % (every - 1) === 0 && e < extra.length) out.push(extra[e++]);
  });
  return [...out, ...extra.slice(e)];
}

/** Подборки-настроения: на запрос жанра («hip hop 2026») они уводят волну в lofi и музыку для сна. */
const MOOD_PLAYLIST = /lo-?fi|chill|sleep|relax|study|ambient|meditation|kids|acoustic|sped up|slowed|christmas|xmas|no[eë]l|halloween|новогод|рождеств/i;
/** Подборки редакторов сервиса: по жанру они ровнее пользовательских. */
const EDITORIAL = /deezer|editor|editrice/i;

/** Слова запроса без года и «новый»: «witch house 2026» → ['witch', 'house']. */
function queryWords(query: string): string[] {
  return normalizeText(query)
    .split(' ')
    .filter((w) => w && !/^(19|20)\d\d$/.test(w) && w !== 'новый');
}

/**
 * Плейлисты из `search/playlist`: id — сначала те, где в названии все слова запроса (редкий жанр: «Witch House», а не
 * «House Party»), среди них и среди остальных — редакторские первыми; подборки-настроения отброшены, если сам запрос не
 * про настроение («lofi», «chillout» и т. п. — их подборки как раз нужны).
 */
function parsePlaylistIds(json: unknown, query = ''): string[] {
  if (!isObject(json) || !Array.isArray(json.data)) return [];
  const moodQuery = MOOD_PLAYLIST.test(query);
  const words = queryWords(query);
  const list = json.data
    .filter(isObject)
    .map((p) => {
      const title = str(p.title);
      const titleWords = normalizeText(title).split(' ');
      const match = words.length > 0 && words.every((w) => titleWords.includes(w));
      const editorial = isObject(p.user) && EDITORIAL.test(str(p.user.name));
      return { id: idStr(p.id), title, rank: (match ? 2 : 0) + (editorial ? 1 : 0) };
    })
    .filter((p) => p.id && (moodQuery || !MOOD_PLAYLIST.test(p.title)));
  return list
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .map((p) => p.id);
}

/** Списки вперемешку по одному: «перемешивание источников сидов». */
function interleave(lists: Track[][]): Track[] {
  const out: Track[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * `count` разных элементов списка, где раньше — чаще: вес позиции i — 1/(i+1). Артисты сида идут по убыванию
 * рейтинга вкуса, так что любимые попадают в волну чаще, но и остальные иногда тоже.
 */
function weightedSample<T>(list: readonly T[], count: number, random: () => number): T[] {
  const rest = list.map((item, i) => ({ item, weight: 1 / (i + 1) }));
  const out: T[] = [];
  while (out.length < count && rest.length > 0) {
    let r = random() * rest.reduce((sum, x) => sum + x.weight, 0);
    let i = 0;
    while (i < rest.length - 1 && r >= rest[i].weight) r -= rest[i++].weight;
    out.push(rest.splice(i, 1)[0].item);
  }
  return out;
}

export interface WaveSettings {
  youtubeEnabled: boolean;
  /** Нет поля — включён (как по умолчанию в настройках). */
  soundcloudEnabled?: boolean;
}

/** Волна SoundCloud: сиды — только треки SoundCloud (волна по треку SoundCloud, «Волна SoundCloud» раздела). */
export function isSoundcloudSeed(seed: WaveSeed): boolean {
  if ((seed.artists?.length ?? 0) > 0 || (seed.queries?.length ?? 0) > 0 || seed.text?.trim()) return false;
  const tracks = [...(seed.tracks ?? []), ...(seed.lead ?? [])];
  return tracks.length > 0 && tracks.every((t) => t.source === 'soundcloud');
}

export interface WaveService {
  /** Первая порция похожих (без `seed.lead`). */
  start(seed: WaveSeed, settings: WaveSettings): Promise<Track[]>;
  /** Следующая порция: источники чередуются по `round`. */
  more(req: WaveMoreRequest, settings: WaveSettings): Promise<Track[]>;
}

export interface WaveDeps {
  run?: RunYtDlp;
  fetchJson?: FetchJson;
  /** Сохранённые адаптером каталога сопоставления «трек каталога → видео» (`catalog-matches.json`). */
  readMatches?: () => Promise<unknown>;
  random?: () => number;
  now?: () => number;
}

type Source = () => Promise<Track[]>;

export function createWaveService(deps: WaveDeps = {}): WaveService {
  const run = deps.run ?? runYtDlp;
  const fetchJson = deps.fetchJson ?? ((url: string) => defaultFetchJson(url, API_TIMEOUT_MS));
  const readMatches = deps.readMatches ?? (() => readJson<unknown>(MATCHES_FILE, null));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;

  const videos = new Map<string, string>();
  const artistIds = new Map<string, { id: string | null; at: number }>();
  const playlists = new Map<string, string[]>();
  /**
   * Зарубежные кандидаты, которые волна подмешала сама (`foreignOf`): сидами дополнения (Mix, радио, жанр) они не
   * становятся — иначе после одного такого трека волна уплывает в чужую сцену целиком.
   */
  const spice = new Set<string>();
  /** Жанр артиста (id в открытом API) английским запросом; null — не определился. */
  const genres = new Map<string, { query: string | null; at: number }>();

  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

  /** Треки из открытого API: только песни, без переделок. */
  const songs = (json: unknown): Track[] => parseDeezerTracks(json).filter(isSongLike);

  async function api(url: string): Promise<unknown> {
    const json = await fetchJson(url);
    if (isObject(json) && isObject(json.error)) throw new SourceError('unavailable', NOTHING_FOUND_MESSAGE);
    return json;
  }

  async function ytJson(args: string[], timeoutMs: number): Promise<unknown> {
    let stdout: string;
    try {
      ({ stdout } = await run(['--flat-playlist', '-J', ...args], undefined, { timeoutMs }));
    } catch (err) {
      throw classifyYtDlpError(err);
    }
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  /** Видео YouTube, на котором звучит трек: свой id, сохранённое сопоставление каталога или поиск. */
  async function videoOf(track: Track): Promise<string> {
    if (track.source === 'youtube' && VIDEO_ID.test(track.sourceId)) return track.sourceId;
    const known = videos.get(track.id);
    if (known) return known;
    if (track.source === 'catalog') {
      const raw = await readMatches().catch(() => null);
      const match = isObject(raw) && isObject(raw.matches) ? raw.matches[track.id] : null;
      // `{source, id}` (звук с SoundCloud видео не даёт) или прежний `{videoId}`.
      const saved = !isObject(match) ? '' : match.source === 'soundcloud' ? '' : str(match.videoId) || str(match.id);
      if (VIDEO_ID.test(saved)) {
        videos.set(track.id, saved);
        return saved;
      }
    }
    const json = await ytJson(['--', ytSearchQuery(track)], SEARCH_TIMEOUT_MS);
    const found = pickYtCandidate(parseYtCandidates(json), track);
    if (!found) throw new SourceError('unavailable', NOTHING_FOUND_MESSAGE);
    videos.set(track.id, found.id);
    return found.id;
  }

  /** Похожие на трек SoundCloud — рекомендации SoundCloud (только песни). */
  async function recommendedOf(track: Track): Promise<Track[]> {
    return (await fetchScRecommended(run, track)).filter(isSongLike);
  }

  /** Похожие на трек — его YouTube Mix. */
  async function mixOf(track: Track): Promise<Track[]> {
    const videoId = await videoOf(track);
    const json = await ytJson(['--playlist-end', String(MIX_LENGTH), '--', mixUrl(videoId)], MIX_TIMEOUT_MS);
    return parseYtMix(json, videoId);
  }

  /** Идущие поиски артиста: треки артиста и его жанр ищут его одновременно — запрос один. */
  const findingIds = new Map<string, Promise<string | null>>();

  /** id артиста в открытом API по точному имени (кэш на сутки); не нашёлся — null. */
  async function artistId(name: string): Promise<string | null> {
    const key = normalizeText(name);
    if (!key) return null;
    const known = artistIds.get(key);
    if (known && now() - known.at < ARTIST_CACHE_MS) return known.id;
    const pending = findingIds.get(key);
    if (pending) return pending;
    const finding = api(`${DEEZER_BASE}/search/artist?q=${enc(name)}&limit=10`)
      .then((json) => {
        const found = pickDeezerArtist(parseDeezerArtists(json), name);
        artistIds.set(key, { id: found?.id ?? null, at: now() });
        return found?.id ?? null;
      })
      .finally(() => findingIds.delete(key));
    findingIds.set(key, finding);
    return finding;
  }

  /** Популярное «похожих артистов» источника (`artist/{id}/related`): несколько случайных, по паре треков, без фильтра языка. */
  async function relatedTracks(id: string): Promise<Track[]> {
    const list = parseDeezerArtists(await api(`${DEEZER_BASE}/artist/${id}/related?limit=${RELATED_LIMIT}`));
    const chosen = shuffle(list, random).slice(0, RELATED_ARTISTS);
    const lists = await Promise.all(
      chosen.map((a) => api(`${DEEZER_BASE}/artist/${a.id}/top?limit=${RELATED_TOP}`).then(songs, () => [] as Track[])),
    );
    return interleave(lists.map((l) => shuffle(l, random).slice(0, RELATED_PER_ARTIST)));
  }

  /** Треки артиста, радио похожих на него и популярное его «похожих артистов». `withTop` — свои треки (в первой порции). */
  async function artistTracks(name: string, withTop: boolean): Promise<Track[]> {
    const id = await artistId(name);
    if (!id) throw new SourceError('unavailable', NOTHING_FOUND_MESSAGE);
    const [top, radio, related] = await Promise.all([
      withTop ? api(`${DEEZER_BASE}/artist/${id}/top?limit=${TOP_LIMIT}`).then(songs, () => []) : Promise.resolve([]),
      api(`${DEEZER_BASE}/artist/${id}/radio?limit=${RADIO_LIMIT}`).then(songs),
      relatedTracks(id).catch(() => [] as Track[]),
    ]);
    const own = shuffle(top, random).slice(0, TOP_PER_ARTIST);
    const others = interleave([radio, related]);
    // Свои треки артиста — через два трека похожих, начиная с первого.
    const out: Track[] = [];
    let r = 0;
    for (const t of own) {
      out.push(t);
      out.push(...others.slice(r, r + 2));
      r += 2;
    }
    return [...out, ...others.slice(r)];
  }

  /** Жанр артиста английским запросом: жанр альбома его популярного трека (кэш на сутки). */
  async function genreQuery(name: string): Promise<string | null> {
    const id = await artistId(name);
    if (!id) return null;
    const known = genres.get(id);
    if (known && now() - known.at < ARTIST_CACHE_MS) return known.query;
    const albumId = firstAlbumId(await api(`${DEEZER_BASE}/artist/${id}/top?limit=1`));
    const genre = albumId ? albumGenre(await api(`${DEEZER_BASE}/album/${albumId}`)) : '';
    const query = genre ? genreQueryOf(genre, new Date(now()).getFullYear()) : null;
    genres.set(id, { query, at: now() });
    return query;
  }

  /** Зарубежное похожее: подборка жанра исполнителя по-английски (не определился жанр или нет сети — пусто). */
  async function foreignOf(name: string): Promise<Track[]> {
    if (!name) return [];
    try {
      const query = await genreQuery(name);
      const tracks = query ? (await queryTracks(query)).slice(0, GENRE_TRACKS) : [];
      for (const t of tracks) spice.add(t.id);
      while (spice.size > SPICE_LIMIT) spice.delete(spice.values().next().value!);
      return tracks;
    } catch {
      return [];
    }
  }

  /** Жанр или настроение — треки случайной подборки по запросу. */
  async function queryTracks(query: string): Promise<Track[]> {
    let ids = playlists.get(query);
    if (!ids) {
      ids = parsePlaylistIds(await api(`${DEEZER_BASE}/search/playlist?q=${enc(query)}&limit=10`), query).slice(0, PLAYLISTS_PER_QUERY);
      if (ids.length > 0) playlists.set(query, ids);
    }
    if (ids.length === 0) {
      // Подборок нет — песни с этим словом.
      return shuffle(songs(await api(`${DEEZER_BASE}/search?q=${enc(query)}&limit=50`)), random);
    }
    const tracks = songs(await api(`${DEEZER_BASE}/playlist/${pick(ids)}/tracks?limit=${PLAYLIST_TRACKS}`));
    return shuffle(tracks, random);
  }

  /** Сид «Своей волны»: артист с таким именем, иначе жанр. */
  async function resolveText(seed: WaveSeed): Promise<WaveSeed> {
    const text = seed.text?.trim();
    if (!text) return seed;
    const isArtist = await artistId(text).catch(() => null);
    return isArtist ? { ...seed, artists: [...(seed.artists ?? []), text] } : { ...seed, queries: [...(seed.queries ?? []), text] };
  }

  /** Все источники выполняются вместе; результат — их треки вперемешку. Ничего не нашлось — первая ошибка. */
  async function gather(sources: Source[]): Promise<Track[]> {
    const settled = await Promise.allSettled(sources.map((s) => s()));
    const lists = settled.filter((s): s is PromiseFulfilledResult<Track[]> => s.status === 'fulfilled').map((s) => s.value);
    const merged = interleave(lists);
    if (merged.length > 0) return merged;
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failed && failed.reason instanceof SourceError && failed.reason.kind === 'offline') throw failed.reason;
    throw new SourceError('unavailable', NOTHING_FOUND_MESSAGE);
  }

  /** Первый источник, который дал треки (по порядку). */
  async function firstOf(sources: Source[]): Promise<Track[]> {
    let lastError: unknown = null;
    for (const s of sources) {
      try {
        const tracks = await s();
        if (tracks.length > 0) return tracks;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError instanceof SourceError && lastError.kind === 'offline') throw lastError;
    throw new SourceError('unavailable', NOTHING_FOUND_MESSAGE);
  }

  function ensureEnabled(seed: WaveSeed, settings: WaveSettings): void {
    // Волна SoundCloud берёт и похожие, и звук на SoundCloud; остальные — с YouTube (Mix или поиск звука каталога).
    if (isSoundcloudSeed(seed)) {
      if (settings.soundcloudEnabled === false) throw new SourceError('disabled', NEEDS_SOUNDCLOUD_MESSAGE);
    } else if (!settings.youtubeEnabled) throw new SourceError('disabled', NEEDS_YOUTUBE_MESSAGE);
  }

  /** Дополнение волны SoundCloud: рекомендации к недавнему треку SoundCloud, через раз — к сиду. */
  function scMore(seed: WaveSeed, recent: Track[], round: number): Promise<Track[]> {
    const last = recent.filter((t) => t.source === 'soundcloud').slice(-RECENT_FOR_MORE);
    const seeds = (seed.tracks ?? seed.lead ?? []).filter((t) => t.source === 'soundcloud');
    const fromRecent: Source | null = last.length > 0 ? () => recommendedOf(pick(last)) : null;
    const fromSeed: Source | null = seeds.length > 0 ? () => recommendedOf(pick(seeds)) : null;
    const order = round % 2 === 0 ? [fromRecent, fromSeed] : [fromSeed, fromRecent];
    return firstOf(order.filter((s): s is Source => s !== null));
  }

  /** Имя основного исполнителя трека — для радио похожих. */
  const mainArtist = (t: Track): string => artistNames(t.artist)[0] ?? '';

  return {
    async start(rawSeed, settings) {
      ensureEnabled(rawSeed, settings);
      if (isSoundcloudSeed(rawSeed)) {
        const tracks = rawSeed.tracks ?? rawSeed.lead ?? [];
        return capPerArtist(interleave([shuffle(rawSeed.extra ?? [], random), await firstOf([() => recommendedOf(pick(tracks))])]));
      }
      const seed = await resolveText(rawSeed);
      const artists = weightedSample(seed.artists ?? [], ARTISTS_PER_BATCH, random);
      const queries = shuffle(seed.queries ?? [], random).slice(0, QUERIES_PER_BATCH);
      const sources: Source[] = [...artists.map((name) => () => artistTracks(name, true)), ...queries.map((q) => () => queryTracks(q))];
      const extra = shuffle(seed.extra ?? [], random);
      if (sources.length === 0) {
        // Только треки-сиды: похожие — Mix одного из них; не нашлось видео — радио его исполнителя (и его «похожие»).
        const tracks = seed.tracks ?? seed.lead ?? [];
        if (tracks.length === 0) throw new SourceError('unavailable', NOTHING_FOUND_MESSAGE);
        const seedTrack = pick(tracks);
        const [similar, foreign] = await Promise.all([
          firstOf([() => mixOf(seedTrack), () => artistTracks(mainArtist(seedTrack), false)]),
          foreignOf(mainArtist(seedTrack)),
        ]);
        return capPerArtist(sprinkle(interleave([extra, similar]), foreign));
      }
      // Запросов жанра нет (волна по артисту) — зарубежное похожее по жанру первого артиста.
      const [similar, foreign] = await Promise.all([
        gather(sources),
        queries.length === 0 ? foreignOf(artists[0] ?? '') : Promise.resolve([] as Track[]),
      ]);
      return capPerArtist(sprinkle(interleave([extra, similar]), foreign));
    },

    async more({ seed: rawSeed, recent, round }, settings) {
      ensureEnabled(rawSeed, settings);
      if (isSoundcloudSeed(rawSeed)) return capPerArtist(await scMore(rawSeed, recent, round));
      const seed = await resolveText(rawSeed);
      // Подмешанное зарубежное — не сид, если есть свои треки волны.
      const own = recent.filter((t) => !spice.has(t.id));
      const tail = (own.length > 0 ? own : recent).slice(-RECENT_FOR_MORE);
      // Переделки (slowed, sped up) — плохие сиды: их Mix уводит в подборки переделок.
      const last = tail.some((t) => isSongLike(t)) ? tail.filter((t) => isSongLike(t)) : tail;
      // Mix лучше всего от трека YouTube: его видео уже известно.
      const forMix = last.filter((t) => t.source === 'youtube');
      const mixSeed = forMix.length > 0 ? pick(forMix) : last.length > 0 ? pick(last) : null;
      const radioSeed = last.length > 0 ? mainArtist(pick(last)) : '';
      const seedArtists = seed.artists ?? [];
      const queries = seed.queries ?? [];

      const fromMix: Source | null = mixSeed ? () => mixOf(mixSeed) : null;
      const fromRecentArtist: Source | null = radioSeed ? () => artistTracks(radioSeed, false) : null;
      const fromSeed: Source | null =
        seedArtists.length > 0 || queries.length > 0
          ? () => {
              const all = [...seedArtists.map((a) => ({ a })), ...queries.map((q) => ({ q }))];
              const choice = pick(all);
              // Какой из артистов — тоже с весом: раньше в сиде (выше рейтинг) — чаще.
              return 'a' in choice ? artistTracks(weightedSample(seedArtists, 1, random)[0], true) : queryTracks(choice.q);
            }
          : seed.tracks && seed.tracks.length > 0
            ? () => mixOf(pick(seed.tracks!))
            : null;

      // Чередование: Mix недавнего трека → сиды волны → радио исполнителя недавнего трека.
      const order = [fromMix, fromSeed, fromRecentArtist];
      const start = ((round % order.length) + order.length) % order.length;
      const rotated = [...order.slice(start), ...order.slice(0, start)].filter((s): s is Source => s !== null);
      // Зарубежное похожее — по жанру исполнителя недавнего трека (или первого артиста сида), каждым пятым.
      const [similar, foreign] = await Promise.all([firstOf(rotated), foreignOf(radioSeed || seedArtists[0] || '')]);
      return capPerArtist(sprinkle(similar, foreign));
    },
  };
}

export const wave = createWaveService();
