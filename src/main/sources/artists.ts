// Артисты: карточки в поиске, страница артиста, релизы, похожие артисты и лента подписок.
// Метаданные — открытый каталог (iTunes search/lookup, без ключа), звук треков — адаптер `catalog` (YouTube).
// Похожие артисты и фото — открытый API Deezer без ключа, только имена и картинки (в интерфейсе их названий нет).
// Модуль не импортирует electron; кэш id артистов — artists-cache.json в userData.
import { CATALOG_ARTIST_NOT_FOUND, type ArtistQuery } from '../../shared/api';
import { artistKey, splitArtists } from '../../shared/artistNames';
import { ARTIST_CARDS, matchesArtistQuery, rankArtistCards, type OwnArtist } from '../../shared/artistSearch';
import type {
  AlbumPage,
  ArtistCard,
  ArtistPage,
  ArtistRef,
  ArtistRelease,
  CountryCode,
  FollowedArtist,
  NamesakeRef,
  PopularArtist,
  ReleaseKind,
  SimilarArtist,
  Track,
} from '../../shared/types';
import { currentCountry } from '../country';
import { readJson, writeJson } from '../store';
import {
  appleRssBase,
  bigArtwork,
  catalogLimiter,
  ITUNES_BASE,
  itunesTrackToTrack,
  normalizeText,
  parseItunesTracks,
  type FetchJson,
  type RateLimiter,
  type RequestPriority,
} from './catalog';
import { fetchJson as defaultFetchJson } from './http';
import { SourceError } from './types';

export const DEEZER_BASE = 'https://api.deezer.com';
export const ARTISTS_CACHE_FILE = 'artists-cache.json';

const DAY_MS = 86_400_000;
/** «Новое от моих артистов» — релизы за последние ~90 дней. */
export const FEED_FOLLOWED_DAYS = 90;
/** Нет релизов за 90 дней — последние релизы подписки за полгода (артист не пропадает из ленты). */
export const FEED_FOLLOWED_FALLBACK_DAYS = 180;
const FEED_FOLLOWED_FALLBACK_COUNT = 3;
/** «Свежее от похожих» — релизы за последние ~60 дней. */
export const FEED_SIMILAR_DAYS = 60;
export const SIMILAR_PER_FOLLOWED = 5;
export const SIMILAR_MAX_ARTISTS = 40;
const SIMILAR_RELEASES_PER_ARTIST = 2;
const FEED_FOLLOWED_LIMIT = 60;
const FEED_SIMILAR_LIMIT = 40;
const PAGE_SIMILAR_LIMIT = 12;
/** Других точных тёзок на странице артиста, открытой по имени. */
const NAMESAKES_LIMIT = 3;
const TOP_TRACKS = 10;
/** Меньше — популярные добираются свежими песнями артиста. */
const TOP_TRACKS_MIN = 8;
const SEARCH_CARDS = ARTIST_CARDS;
const LOOKUP_CHUNK = 10;
const LOOKUP_LIMIT = 200;
const LOOKUP_TIMEOUT_MS = 25_000;
/** Столько поисков артистов подряд не удались — каталог недоступен, лента собирается из того, что нашлось. */
const CATALOG_FAILURES_IN_ROW = 3;
const RETRY_DELAY_MS = 800;
const CACHE_TTL_MS = 30 * DAY_MS;
const CACHE_MISS_TTL_MS = 7 * DAY_MS;
const RELATED_TTL_MS = 6 * 3600_000;
/** Популярных артистов (подсказки подписок, первый запуск) — столько и столько держим в памяти. */
const POPULAR_LIMIT = 30;
const POPULAR_TTL_MS = 6 * 3600_000;
const POPULAR_PICTURES_AT_ONCE = 8;
const CACHE_LIMIT = 3000;
/** Страны поиска в каталоге: выбранная, затем США (там есть всё), без повтора. */
const countriesOf = (country: CountryCode): CountryCode[] => (country === 'us' ? ['us'] : [country, 'us']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const idStr = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : /^\d+$/.test(str(v)) ? str(v) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const dateOnly = (v: unknown): string => /^(\d{4}-\d{2}-\d{2})/.exec(str(v))?.[1] ?? '';
const results = (json: unknown): unknown[] => (isObject(json) && Array.isArray(json.results) ? json.results : []);

// ---------- Разбор ответов каталога ----------

export interface CatalogArtist extends ArtistRef {
  genre?: string;
}

/** Артисты из поиска каталога (`entity=musicArtist`) или обёртки lookup. */
export function parseItunesArtists(json: unknown): CatalogArtist[] {
  const out: CatalogArtist[] = [];
  const seen = new Set<string>();
  for (const r of results(json)) {
    const a = toCatalogArtist(r);
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

function toCatalogArtist(r: unknown): CatalogArtist | null {
  if (!isObject(r) || r.wrapperType !== 'artist') return null;
  const id = idStr(r.artistId);
  const name = str(r.artistName);
  if (!id || !name) return null;
  const a: CatalogArtist = { id, name };
  if (str(r.primaryGenreName)) a.genre = str(r.primaryGenreName);
  return a;
}

/** Релиз (коллекция) из lookup `entity=album`. */
export interface CatalogCollection {
  id: string;
  /** Название как в каталоге (с « - Single» / « - EP»). */
  title: string;
  artist: string;
  artistId: string;
  collectionArtist?: string;
  type: string;
  trackCount: number;
  /** `YYYY-MM-DD` */
  releaseDate: string;
  explicit: boolean;
  coverUrl?: string;
}

export interface ArtistAlbums {
  artist: CatalogArtist;
  collections: CatalogCollection[];
}

function toCollection(r: Record<string, unknown>): CatalogCollection | null {
  const id = idStr(r.collectionId);
  const title = str(r.collectionName);
  const releaseDate = dateOnly(r.releaseDate);
  if (!id || !title || !releaseDate) return null;
  const c: CatalogCollection = {
    id,
    title,
    artist: str(r.artistName) || 'Неизвестный исполнитель',
    artistId: idStr(r.artistId),
    type: str(r.collectionType),
    trackCount: num(r.trackCount),
    releaseDate,
    explicit: r.collectionExplicitness === 'explicit',
  };
  if (str(r.collectionArtistName)) c.collectionArtist = str(r.collectionArtistName);
  const art = str(r.artworkUrl100) || str(r.artworkUrl60);
  if (art.startsWith('https://')) c.coverUrl = bigArtwork(art);
  return c;
}

/**
 * Lookup `entity=album` одного или нескольких артистов: каталог отдаёт обёртку артиста, за ней — его релизы
 * (в том числе чужие, где он участвует), затем следующего артиста.
 */
export function parseArtistAlbums(json: unknown): ArtistAlbums[] {
  const groups: ArtistAlbums[] = [];
  let current: (ArtistAlbums & { seen: Set<string> }) | null = null;
  for (const r of results(json)) {
    if (!isObject(r)) continue;
    const artist = toCatalogArtist(r);
    if (artist) {
      current = { artist, collections: [], seen: new Set() };
      groups.push(current);
      continue;
    }
    if (!current || r.wrapperType !== 'collection') continue;
    const c = toCollection(r);
    if (c && !current.seen.has(c.id)) {
      current.seen.add(c.id);
      current.collections.push(c);
    }
  }
  return groups.map(({ artist, collections }) => ({ artist, collections }));
}

// ---------- Фильтр миксов и сборников ----------

/** Диджейские миксы каталога: «Трек (Mixed)», «[Mixed]», альбом «… (DJ Mix)», «Mixed by …». */
const MIX = /[([]\s*mixed\s*[)\]]|\bdj[\s-]?mix\b|\bmixed by\b|\bcontinuous mix\b|\bnon[\s-]?stop mix\b/i;
const VARIOUS = /^(various artists|разные артисты|сборник|verschiedene interpreten|multi-interprètes)$/i;
/** Не музыка артиста: биты «type beat», инструменталы, караоке, видеоверсии альбомов. */
const JUNK = /type[\s-]?beat|instrumental|инструментал|karaoke|караоке|минусовка|\bvideo version\b/i;
const REMIX = /remix|ремикс|\bedit\b/i;

/** Диджейский микс или сборник «разных артистов»: такие релизы и треки на странице артиста не показываются. */
export function isMixOrCompilation(item: { title: string; album?: string; artist: string; collectionArtist?: string; type?: string }): boolean {
  if (MIX.test(item.title) || (item.album && MIX.test(item.album))) return true;
  if (VARIOUS.test(item.artist.trim()) || (item.collectionArtist && VARIOUS.test(item.collectionArtist.trim()))) return true;
  return item.type === 'Compilation';
}

/** Ключ артиста (`artistKey`) среди исполнителей строки — тот же разбор, что во всём приложении. */
const namesKeys = (artist: string, title?: string): string[] => splitArtists(artist, title).map(artistKey);

/** Артист указан в «feat. …» / «with …» названия. */
const featuring = (title: string, name: string): boolean => namesKeys('', title).includes(name);

/** Артист — один из исполнителей строки («A & B», «A feat. B»). */
const among = (artistField: string, name: string): boolean => namesKeys(artistField).includes(name);

/** Артист — автор или соавтор (в имени исполнителей) — или участник («feat.» в названии). */
function involves(artistField: string, artistId: string, title: string, artist: ArtistRef): boolean {
  const name = artistKey(artist.name);
  return artistId === artist.id || among(artistField, name) || featuring(title, name);
}

const releaseTitle = (title: string): string => title.replace(/\s+-\s+(Single|EP)$/i, '').trim() || title;

/**
 * Вид релиза: суффикс « - EP» / « - Single» в названии (так их помечает каталог), затем тип коллекции,
 * если он не общий «Album», и только потом число треков: 1–3 — сингл, 4–6 — EP, 7+ — альбом.
 */
function releaseKind(c: Pick<CatalogCollection, 'title' | 'type' | 'trackCount'>): ReleaseKind {
  if (/\s-\s+EP$/i.test(c.title)) return 'ep';
  if (/\s-\s+Single$/i.test(c.title)) return 'single';
  if (/^single$/i.test(c.type)) return 'single';
  if (/^ep$/i.test(c.type)) return 'ep';
  if (c.trackCount > 0 && c.trackCount <= 3) return 'single';
  if (c.trackCount > 3 && c.trackCount <= 6) return 'ep';
  return 'album';
}

/**
 * Релизы артиста для страницы и ленты: без диджейских миксов, сборников, «type beat», чужих ремиксов
 * (ремикс чужого трека, где артист лишь гость), без дублей explicit/cleaned и переизданий с тем же
 * названием; от новых к старым.
 */
export function selectReleases(collections: CatalogCollection[], artist: ArtistRef): ArtistRelease[] {
  const name = artistKey(artist.name);
  const best = new Map<string, CatalogCollection>();
  for (const c of collections) {
    if (isMixOrCompilation({ title: c.title, artist: c.artist, collectionArtist: c.collectionArtist, type: c.type })) continue;
    if (JUNK.test(c.title) || JUNK.test(c.artist)) continue;
    const own = c.artistId === artist.id || among(c.artist, name);
    if (!own && (REMIX.test(c.title) || !featuring(c.title, name))) continue;
    const key = `${normalizeText(releaseTitle(c.title))}|${normalizeText(c.artist)}`;
    const prev = best.get(key);
    if (!prev || (c.explicit && !prev.explicit) || (c.explicit === prev.explicit && c.releaseDate > prev.releaseDate)) best.set(key, c);
  }
  return [...best.values()]
    .sort((a, b) => (a.releaseDate === b.releaseDate ? 0 : a.releaseDate < b.releaseDate ? 1 : -1))
    .map((c) => toRelease(c, artist.id));
}

function toRelease(c: CatalogCollection, artistId: string): ArtistRelease {
  const r: ArtistRelease = {
    id: c.id,
    title: releaseTitle(c.title),
    artist: c.artist,
    artistId,
    kind: releaseKind(c),
    releaseDate: c.releaseDate,
    trackCount: c.trackCount,
  };
  if (c.coverUrl) r.coverUrl = c.coverUrl;
  return r;
}

/**
 * Lookup коллекции `lookup?id=<релиз>&entity=song`: первой записью — обёртка коллекции (название, исполнитель, тип,
 * дата, обложка), за ней — песни. Песни — только этого релиза, по диску и номеру. Песен нет — null.
 * Нет обёртки (бывает у переизданий) — релиз собирается из первой песни.
 */
export function parseAlbumLookup(json: unknown, releaseId: string): AlbumPage | null {
  const id = idStr(releaseId);
  const songs = parseItunesTracks(json)
    .filter((t) => t.collectionId === id)
    .sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
  if (!id || songs.length === 0) return null;
  const wrapper = results(json).find((r): r is Record<string, unknown> => isObject(r) && r.wrapperType === 'collection' && idStr(r.collectionId) === id);
  const first = songs[0];
  const collection: CatalogCollection = (wrapper && toCollection(wrapper)) || {
    id,
    title: first.album ?? first.title,
    artist: first.artist,
    artistId: '',
    type: '',
    trackCount: songs.length,
    releaseDate: first.releaseDate,
    explicit: false,
    ...(first.coverUrl ? { coverUrl: first.coverUrl } : {}),
  };
  if (collection.trackCount <= 0) collection.trackCount = songs.length;
  const tracks = songs.map(itunesTrackToTrack);
  return {
    release: toRelease(collection, collection.artistId),
    tracks,
    durationSec: tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0),
  };
}

/** Название без пометок в скобках — для дублей одной песни с альбома и сингла. */
const coreTitle = (title: string): string => normalizeText(title.replace(/[([{].*?[)\]}]/g, ' ')) || normalizeText(title);
const firstArtist = (artist: string): string => artistKey(splitArtists(artist)[0] ?? artist);
const songKey = (t: { title: string; artist: string }): string => `${coreTitle(t.title)}|${firstArtist(t.artist)}`;

/**
 * Песни артиста из поиска (`entity=song&attribute=artistTerm` — по популярности) или lookup `entity=song`:
 * только с участием артиста, без миксов, сборников, битов и инструменталов, без повторов одной песни.
 */
export function parseArtistSongs(json: unknown, artist: ArtistRef, limit = TOP_TRACKS): Track[] {
  const kept: unknown[] = [];
  const seen = new Set<string>();
  for (const r of results(json)) {
    if (!isObject(r) || r.wrapperType !== 'track' || r.kind !== 'song') continue;
    const title = str(r.trackName);
    const artistName = str(r.artistName);
    const album = str(r.collectionName);
    if (!title) continue;
    if (isMixOrCompilation({ title, album, artist: artistName, collectionArtist: str(r.collectionArtistName) })) continue;
    if (JUNK.test(title) || JUNK.test(artistName) || JUNK.test(album)) continue;
    if (!involves(artistName, idStr(r.artistId), title, artist)) continue;
    // Тёзка: песня исполнителя с точно таким же именем, но другим id — не этого артиста.
    const owner = idStr(r.artistId);
    if (owner && owner !== artist.id && artistKey(artistName) === artistKey(artist.name)) continue;
    const key = songKey({ title, artist: artistName });
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(r);
    if (kept.length >= limit) break;
  }
  return parseItunesTracks({ results: kept }).map(itunesTrackToTrack);
}

/**
 * Какой из точных тёзок поёт эту песню: исполнитель первой песни из поиска, у которой название то же
 * (скобки и пометки не важны) и id исполнителя — один из тёзок. Нет такой — null.
 */
export function pickNamesakeBySong(json: unknown, namesakes: readonly CatalogArtist[], title: string): CatalogArtist | null {
  const want = coreTitle(title);
  if (!want) return null;
  for (const r of results(json)) {
    if (!isObject(r) || r.wrapperType !== 'track' || r.kind !== 'song') continue;
    const artistId = idStr(r.artistId);
    const found = namesakes.find((a) => a.id === artistId);
    if (found && coreTitle(str(r.trackName)) === want) return found;
  }
  return null;
}

// ---------- Похожие артисты и фото (открытый API без ключа) ----------

export interface DeezerArtist {
  id: string;
  name: string;
  fans: number;
  imageUrl?: string;
}

/** Артисты из `search/artist` или `artist/{id}/related`; заглушка вместо фото (пустой хэш картинки) не берётся. */
export function parseDeezerArtists(json: unknown): DeezerArtist[] {
  const data = isObject(json) && Array.isArray(json.data) ? json.data : [];
  const out: DeezerArtist[] = [];
  for (const r of data) {
    if (!isObject(r)) continue;
    const id = idStr(r.id);
    const name = str(r.name);
    if (!id || !name) continue;
    const a: DeezerArtist = { id, name, fans: num(r.nb_fan) };
    const pic = str(r.picture_xl) || str(r.picture_big);
    if (pic.startsWith('https://') && !pic.includes('/artist//')) a.imageUrl = pic;
    out.push(a);
  }
  return out;
}

/** Тот же артист по имени (без учёта регистра и знаков); из тёзок — самый популярный. */
export function pickDeezerArtist(list: DeezerArtist[], name: string): DeezerArtist | null {
  const n = normalizeText(name);
  let best: DeezerArtist | null = null;
  for (const a of list) if (normalizeText(a.name) === n && (!best || a.fans > best.fans)) best = a;
  return best;
}

// ---------- Популярные артисты (чарт страны) ----------

/** Жанры песен чарта (как их называет каталог страны) → теги `GENRES`. */
const CHART_GENRE_TAGS: [tag: string, words: string[]][] = [
  ['hiphop', ['хип-хоп', 'рэп', 'hip-hop', 'hip hop', 'rap']],
  ['pop', ['поп', 'pop']],
  ['rock', ['рок', 'rock']],
  ['electronic', ['электрон', 'танцев', 'хаус', 'техно', 'electronic', 'dance', 'house', 'techno']],
  ['indie', ['инди', 'альтернатив', 'indie', 'alternative']],
  ['metal', ['метал', 'metal']],
  ['jazz', ['джаз', 'jazz']],
  ['classical', ['классич', 'classical']],
  ['soundtrack', ['саундтрек', 'soundtrack']],
  ['folk', ['фолк', 'folk']],
  ['blues', ['блюз', 'blues']],
  ['reggae', ['регги', 'reggae']],
  ['ambient', ['эмбиент', 'ambient']],
  ['chillout', ['чилаут', 'chill']],
];

export function chartGenreTags(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const n = name.toLowerCase();
    for (const [tag, words] of CHART_GENRE_TAGS) if (!out.includes(tag) && words.some((w) => n.includes(w))) out.push(tag);
  }
  return out;
}

/** Имя со страницы артиста в адресе: `…/artist/маяк-x/123` → «маяк x». */
function urlName(url: string): string {
  const slug = /\/artist\/([^/?#]+)\//.exec(url)?.[1] ?? '';
  try {
    return artistKey(decodeURIComponent(slug));
  } catch {
    return artistKey(slug);
  }
}

/**
 * Исполнители песен чарта в его порядке, без повторов. У песни «A & B» id — основного исполнителя, поэтому имя —
 * то, что совпадает с адресом его страницы (дуэт с одной страницей остаётся дуэтом, у «A & B» со страницей A — это A).
 */
export function parsePopularArtists(json: unknown): PopularArtist[] {
  const feed = isObject(json) && isObject(json.feed) ? json.feed : null;
  if (!feed || !Array.isArray(feed.results)) return [];
  const out: PopularArtist[] = [];
  const seen = new Set<string>();
  for (const r of feed.results) {
    if (!isObject(r)) continue;
    const id = idStr(r.artistId);
    const full = str(r.artistName);
    if (!id || !full || seen.has(id)) continue;
    const fromUrl = urlName(str(r.artistUrl));
    const candidates = [full, ...splitArtists(full)];
    const name = candidates.find((c) => artistKey(c) === fromUrl) ?? candidates[candidates.length > 1 ? 1 : 0];
    if (!artistKey(name)) continue;
    seen.add(id);
    const genres = Array.isArray(r.genres) ? r.genres.map((g) => (isObject(g) ? str(g.name) : '')).filter(Boolean) : [];
    const tags = chartGenreTags(genres);
    out.push(tags.length > 0 ? { id, name, tags } : { id, name });
  }
  return out;
}

// ---------- Сервис ----------

export interface ArtistFeedData {
  followed: ArtistRelease[];
  similar: ArtistRelease[];
  followedIds: string[];
}

export interface ArtistsServiceDeps {
  fetchJson?: FetchJson;
  readCache?: () => Promise<unknown>;
  writeCache?: (data: unknown) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Ограничитель частоты запросов к каталогу (по умолчанию общий `catalogLimiter`). */
  limiter?: RateLimiter;
  /** Страна каталога (по умолчанию — из настроек). */
  country?: () => CountryCode;
  /** Сроки шагов сборки ленты (тесты задают короткие). */
  feedTimeouts?: Partial<FeedTimeouts>;
}

/** Сроки шагов сборки ленты: ни один шаг не держит её дольше своего срока. */
export interface FeedTimeouts {
  /** Релизы подписок (запросы ждут своей очереди у ограничителя каталога). */
  followedMs: number;
  /** Похожие одной подписки (поиск артиста и его похожих в открытом API). */
  relatedMs: number;
  /** Все поиски id похожих в каталоге (фон — 15 запросов в минуту): не успели — берём найденное. */
  idsBudgetMs: number;
  /** Релизы похожих. */
  similarMs: number;
}

export const FEED_TIMEOUTS: FeedTimeouts = {
  followedMs: 3 * 60_000,
  relatedMs: 40_000,
  idsBudgetMs: 4 * 60_000,
  similarMs: 2 * 60_000,
};

/** Сколько подписок спрашивают похожих разом. */
const RELATED_AT_ONCE = 5;

/** Обещание с отказом по сроку: шаг ленты не должен висеть вечно (сам запрос дорабатывает в фоне). */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SourceError('unavailable', message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Поровну на каждую подписку: по кругу — первый похожий каждой, затем второй… Не больше `perEach` на подписку и
 * `max` всего. Списки — в порядке подписок (свежие первыми), дубли (тот же ключ) берутся один раз.
 */
export function roundRobin<T>(lists: readonly (readonly T[])[], key: (item: T) => string, perEach: number, max: number): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const pos = lists.map(() => 0);
  const taken = lists.map(() => 0);
  for (let progress = true; progress && out.length < max; ) {
    progress = false;
    for (let i = 0; i < lists.length && out.length < max; i++) {
      if (taken[i] >= perEach) continue;
      const list = lists[i];
      while (pos[i] < list.length) {
        const item = list[pos[i]++];
        const k = key(item);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(item);
        taken[i]++;
        progress = true;
        break;
      }
    }
  }
  return out;
}

/** Похожих на одну подписку: поровну между всеми, но не больше `SIMILAR_PER_FOLLOWED`. */
export const similarPerFollowed = (followedCount: number): number =>
  Math.max(1, Math.min(SIMILAR_PER_FOLLOWED, Math.ceil(SIMILAR_MAX_ARTISTS / Math.max(1, followedCount))));

export interface ArtistsService {
  /** Карточки артистов поиска; own — свои артисты пользователя (идут первыми). */
  search(query: string, own?: readonly OwnArtist[]): Promise<ArtistCard[]>;
  page(query: ArtistQuery): Promise<ArtistPage>;
  release(releaseId: string): Promise<Track[]>;
  /** Страница альбома — тот же lookup, что у `release`, с метаданными из обёртки коллекции. */
  album(releaseId: string): Promise<AlbumPage>;
  /** Исполнители «Популярного сейчас» своей страны с фото (кэш в памяти на 6 ч). */
  popular(): Promise<PopularArtist[]>;
  /** Лента подписок; `onFollowed` — релизы подписок готовы (похожие собираются дольше). */
  buildFeed(followed: readonly FollowedArtist[], onFollowed?: (followed: ArtistRelease[]) => void): Promise<ArtistFeedData>;
}

interface CacheEntry {
  id: string | null;
  name?: string;
  imageUrl?: string;
  at: number;
}

interface ArtistsCache {
  /** Имя (нормализованное) → артист Deezer: id для похожих и фото. */
  deezer: Map<string, CacheEntry>;
  /** Имя (нормализованное) → id артиста в каталоге. */
  catalog: Map<string, CacheEntry>;
}

function readCacheMap(raw: unknown): Map<string, CacheEntry> {
  const map = new Map<string, CacheEntry>();
  if (!isObject(raw)) return map;
  for (const [k, v] of Object.entries(raw)) {
    if (!isObject(v) || typeof v.at !== 'number') continue;
    const id = v.id === null ? null : idStr(v.id);
    if (id === '') continue;
    const e: CacheEntry = { id, at: v.at };
    if (str(v.name)) e.name = str(v.name);
    if (str(v.imageUrl).startsWith('https://')) e.imageUrl = str(v.imageUrl);
    map.set(k, e);
  }
  return map;
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const enc = encodeURIComponent;
const artistSearchUrl = (term: string, country: string) => `${ITUNES_BASE}/search?term=${enc(term)}&entity=musicArtist&country=${country}&limit=10`;
const albumsUrl = (ids: string[], country: string) =>
  `${ITUNES_BASE}/lookup?id=${ids.join(',')}&entity=album&limit=${LOOKUP_LIMIT}&sort=recent&country=${country}`;
/** Песня «исполнитель + название» — чтобы узнать, какому из тёзок она принадлежит. */
const songByTitleUrl = (name: string, title: string, country: string) =>
  `${ITUNES_BASE}/search?term=${enc(`${name} ${title}`)}&entity=song&country=${country}&limit=10`;
const topSongsUrl = (name: string, country: string) =>
  `${ITUNES_BASE}/search?term=${enc(name)}&entity=song&attribute=artistTerm&country=${country}&limit=50`;
const songsUrl = (id: string, country: string) => `${ITUNES_BASE}/lookup?id=${id}&entity=song&limit=100&sort=recent&country=${country}`;
const releaseUrl = (id: string, country: string) => `${ITUNES_BASE}/lookup?id=${id}&entity=song&country=${country}`;
const popularUrl = (country: CountryCode) => `${appleRssBase(country)}/songs.json`;
const deezerSearchUrl = (name: string) => `${DEEZER_BASE}/search/artist?q=${enc(name)}&limit=10`;
/** Поиск артистов по запросу — нечёткий: совпадение проверяет `matchesArtistQuery`. */
const deezerQueryUrl = (query: string) => `${DEEZER_BASE}/search/artist?q=${enc(query)}&limit=25`;
const deezerRelatedUrl = (id: string) => `${DEEZER_BASE}/artist/${id}/related?limit=20`;

const isOffline = (err: unknown) => err instanceof SourceError && err.kind === 'offline';
const sinceDate = (now: number, days: number) => new Date(now - days * DAY_MS).toISOString().slice(0, 10);

export function createArtistsService(deps: ArtistsServiceDeps = {}): ArtistsService {
  const fetchJson = deps.fetchJson ?? ((url: string) => defaultFetchJson(url, LOOKUP_TIMEOUT_MS));
  const readCache = deps.readCache ?? (() => readJson<unknown>(ARTISTS_CACHE_FILE, null));
  const writeCache = deps.writeCache ?? ((data: unknown) => writeJson(ARTISTS_CACHE_FILE, data));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const limiter = deps.limiter ?? catalogLimiter;
  const countries = (): CountryCode[] => countriesOf((deps.country ?? currentCountry)());
  const feedTimeouts: FeedTimeouts = { ...FEED_TIMEOUTS, ...deps.feedTimeouts };

  let cache: Promise<ArtistsCache> | null = null;
  let dirty = false;
  const related = new Map<string, { at: number; list: DeezerArtist[] }>();
  let popularCache: { country: CountryCode; at: number; list: PopularArtist[] } | null = null;
  let popularLoading: { country: CountryCode; promise: Promise<PopularArtist[]> } | null = null;

  const loadCache = () =>
    (cache ??= readCache().then(
      (raw) => ({
        deezer: readCacheMap(isObject(raw) ? raw.deezer : null),
        catalog: readCacheMap(isObject(raw) ? raw.catalog : null),
      }),
      () => ({ deezer: new Map(), catalog: new Map() }),
    ));

  async function saveCache(): Promise<void> {
    if (!dirty) return;
    dirty = false;
    const c = await loadCache();
    const trim = (m: Map<string, CacheEntry>) => {
      while (m.size > CACHE_LIMIT) m.delete(m.keys().next().value!);
      return Object.fromEntries(m);
    };
    await writeCache({ version: 1, deezer: trim(c.deezer), catalog: trim(c.catalog) }).catch(() => undefined);
  }

  const fresh = (e: CacheEntry | undefined): e is CacheEntry => !!e && now() - e.at < (e.id ? CACHE_TTL_MS : CACHE_MISS_TTL_MS);

  /** Запросы к каталогу — через ограничитель частоты (и повтор тоже), к Deezer — напрямую. */
  const fetchVia = (url: string, priority: RequestPriority): Promise<unknown> =>
    url.startsWith(ITUNES_BASE) ? limiter.run(priority, () => fetchJson(url)) : fetchJson(url);

  /** Запрос с одним повтором: каталог иногда отвечает ошибкой. Нет сети — сразу ошибка. */
  async function get(url: string, priority: RequestPriority = 'user'): Promise<unknown> {
    try {
      return await fetchVia(url, priority);
    } catch (err) {
      if (isOffline(err)) throw err;
      await sleep(RETRY_DELAY_MS);
      return fetchVia(url, priority);
    }
  }

  /** Релизы артистов разом (российский и зарубежный каталоги вместе): id → артист и его релизы. */
  async function albumsOf(ids: string[], priority: RequestPriority = 'user'): Promise<Map<string, ArtistAlbums>> {
    const out = new Map<string, ArtistAlbums>();
    const requests = chunks(ids, LOOKUP_CHUNK).flatMap((part) => countries().map((c) => get(albumsUrl(part, c), priority)));
    const settled = await Promise.allSettled(requests);
    const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failed.length === settled.length && failed.length > 0) throw failed[0].reason;
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      for (const g of parseArtistAlbums(s.value)) {
        const prev = out.get(g.artist.id);
        if (!prev) {
          out.set(g.artist.id, g);
          continue;
        }
        const seen = new Set(prev.collections.map((c) => c.id));
        prev.collections.push(...g.collections.filter((c) => !seen.has(c.id)));
        if (!prev.artist.genre && g.artist.genre) prev.artist.genre = g.artist.genre;
      }
    }
    return out;
  }

  /** Артист Deezer по имени (кэш на месяц). */
  async function deezerArtist(name: string): Promise<CacheEntry | null> {
    const key = normalizeText(name);
    if (!key) return null;
    const c = await loadCache();
    const known = c.deezer.get(key);
    if (fresh(known)) return known.id ? known : null;
    const pick = pickDeezerArtist(parseDeezerArtists(await get(deezerSearchUrl(name))), name);
    const entry: CacheEntry = pick ? { id: pick.id, at: now(), ...(pick.imageUrl ? { imageUrl: pick.imageUrl } : {}) } : { id: null, at: now() };
    c.deezer.set(key, entry);
    dirty = true;
    return entry.id ? entry : null;
  }

  async function relatedOf(deezerId: string): Promise<DeezerArtist[]> {
    const known = related.get(deezerId);
    if (known && now() - known.at < RELATED_TTL_MS) return known.list;
    const list = parseDeezerArtists(await get(deezerRelatedUrl(deezerId)));
    related.set(deezerId, { at: now(), list });
    return list;
  }

  /** Фото артиста; не нашлось или нет сети — без фото. */
  const pictureOf = (name: string) => deezerArtist(name).then((e) => e?.imageUrl, () => undefined);

  /**
   * Артист каталога по имени — только при точном совпадении (`artistKey`: регистр и знаки не важны); из тёзок —
   * с тем же жанром, если он известен. Похожее имя («Sqwore Beats» на «sqwore») — не он: null.
   */
  async function catalogArtistByName(
    name: string,
    genre?: string,
    searchIn: readonly string[] = countries(),
    priority: RequestPriority = 'user',
  ): Promise<CatalogArtist | null> {
    const { same } = await exactArtists(name, searchIn, priority);
    return (genre && same.find((a) => a.genre === genre)) || same[0] || null;
  }

  /** Все точные тёзки в каталоге (порядок каталога) и страна, где они нашлись: первая страна, где есть хоть один. */
  async function exactArtists(
    name: string,
    searchIn: readonly string[] = countries(),
    priority: RequestPriority = 'user',
  ): Promise<{ same: CatalogArtist[]; country: string | null }> {
    const n = artistKey(name);
    if (!n) return { same: [], country: null };
    for (const country of searchIn) {
      const list = parseItunesArtists(await get(artistSearchUrl(name, country), priority));
      const same = list.filter((a) => artistKey(a.name) === n);
      if (same.length > 0) return { same, country };
    }
    return { same: [], country: null };
  }

  /**
   * Из точных тёзок — тот, чья эта песня: один запрос поиска песни «исполнитель + название» (через ограничитель).
   * Не нашлось или каталог не ответил — null, страница откроется по умолчанию.
   */
  async function namesakeBySong(name: string, title: string, same: readonly CatalogArtist[], country: string): Promise<CatalogArtist | null> {
    try {
      return pickNamesakeBySong(await get(songByTitleUrl(name, title, country)), same, title);
    } catch {
      return null;
    }
  }

  /** Фото и жанр других тёзок: обложка их свежего релиза (один запрос на все); не получилось — без фото. */
  async function namesakeCards(others: readonly CatalogArtist[]): Promise<NamesakeRef[]> {
    if (others.length === 0) return [];
    const groups = await albumsOf(others.map((a) => a.id)).catch(() => new Map<string, ArtistAlbums>());
    return others.map((a) => {
      const group = groups.get(a.id);
      const cover = group ? selectReleases(group.collections, a).find((r) => r.coverUrl)?.coverUrl : undefined;
      const genre = a.genre ?? group?.artist.genre;
      return { id: a.id, name: a.name, ...(genre ? { genre } : {}), ...(cover ? { imageUrl: cover } : {}) };
    });
  }

  /** Артисты каталога по запросу: своя страна, ничего подходящего — зарубежный каталог. */
  async function catalogArtistsFor(q: string): Promise<CatalogArtist[]> {
    let list: CatalogArtist[] = [];
    for (const country of countries()) {
      list = parseItunesArtists(await get(artistSearchUrl(q, country)));
      if (list.some((a) => matchesArtistQuery(a.name, q))) break;
    }
    return list;
  }

  /**
   * Карточки артистов: свои (`own`) первыми, затем по популярности (фанаты в открытом API), остальные — ниже;
   * каталог и открытый API вместе, без дублей. У карточки без id каталога страница найдётся по имени при клике.
   * Не ответил ни каталог, ни открытый API — ошибка (первая).
   */
  async function search(query: string, own: readonly OwnArtist[] = []): Promise<ArtistCard[]> {
    const q = query.trim();
    if (!q) return [];
    const [catalogRes, popularRes] = await Promise.allSettled([catalogArtistsFor(q), get(deezerQueryUrl(q)).then(parseDeezerArtists)]);
    if (catalogRes.status === 'rejected' && popularRes.status === 'rejected') throw catalogRes.reason;
    const c = await loadCache();
    const knownIds = new Map<string, string>();
    for (const [key, e] of c.catalog) if (e.id && fresh(e) && (!e.name || artistKey(e.name) === key)) knownIds.set(key, e.id);
    const cards = rankArtistCards({
      query: q,
      own,
      catalog: catalogRes.status === 'fulfilled' ? catalogRes.value : [],
      popular:
        popularRes.status === 'fulfilled' ? popularRes.value.map((a) => ({ name: a.name, fans: a.fans, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) })) : [],
      knownIds,
      max: SEARCH_CARDS,
    });
    const withPictures = await Promise.all(
      cards.map(async (card) => {
        if (card.imageUrl) return card;
        const imageUrl = await pictureOf(card.name);
        return imageUrl ? { ...card, imageUrl } : card;
      }),
    );
    await saveCache();
    return withPictures;
  }

  async function page(query: ArtistQuery): Promise<ArtistPage> {
    let id = 'id' in query ? idStr(query.id) : '';
    let others: CatalogArtist[] = [];
    if (!id) {
      const name = 'name' in query ? query.name.trim() : '';
      const { same, country } = name ? await exactArtists(name) : { same: [], country: null };
      if (same.length === 0 || !country) throw new SourceError('unavailable', CATALOG_ARTIST_NOT_FOUND);
      // Несколько точных тёзок: трек, с которого перешли, говорит, чей он; иначе — первый из каталога.
      const title = 'track' in query ? query.track?.title.trim() : '';
      const pick = (same.length > 1 && title ? await namesakeBySong(name, title, same, country) : null) ?? same[0];
      id = pick.id;
      others = same.filter((a) => a.id !== pick.id).slice(0, NAMESAKES_LIMIT);
    }

    const group = (await albumsOf([id])).get(id);
    if (!group) throw new SourceError('unavailable', CATALOG_ARTIST_NOT_FOUND);
    const artist = group.artist;
    const releases = selectReleases(group.collections, artist);

    const [top, deezer] = await Promise.allSettled([get(topSongsUrl(artist.name, countries()[0])), deezerArtist(artist.name)]);
    let topTracks = top.status === 'fulfilled' ? parseArtistSongs(top.value, artist) : [];
    // Поиск по популярности дал мало песен (у молодых артистов) — добираем свежими песнями из каталога.
    for (const country of countries()) {
      if (topTracks.length >= TOP_TRACKS_MIN) break;
      const more = parseArtistSongs(await get(songsUrl(id, country)).catch(() => null), artist, TOP_TRACKS * 2);
      const seen = new Set(topTracks.map(songKey));
      for (const t of more) {
        if (topTracks.length >= TOP_TRACKS) break;
        if (seen.has(songKey(t))) continue;
        seen.add(songKey(t));
        topTracks = [...topTracks, t];
      }
    }

    const dz = deezer.status === 'fulfilled' ? deezer.value : null;
    let similar: SimilarArtist[] = [];
    if (dz?.id) {
      const self = normalizeText(artist.name);
      similar = (await relatedOf(dz.id).catch(() => []))
        .filter((a) => normalizeText(a.name) !== self)
        .slice(0, PAGE_SIMILAR_LIMIT)
        .map((a) => (a.imageUrl ? { name: a.name, imageUrl: a.imageUrl } : { name: a.name }));
    }
    await saveCache();

    const imageUrl = dz?.imageUrl ?? releases.find((r) => r.coverUrl)?.coverUrl;
    const head: ArtistPage['artist'] = { id: artist.id, name: artist.name };
    if (artist.genre) head.genre = artist.genre;
    if (imageUrl) head.imageUrl = imageUrl;
    const namesakes = await namesakeCards(others);
    return { artist: head, topTracks, releases, similar, ...(namesakes.length > 0 ? { namesakes } : {}) };
  }

  /** Релиз в каталоге своей страны, затем зарубежном: обёртка коллекции и треки одним lookup. */
  async function album(releaseId: string): Promise<AlbumPage> {
    const id = idStr(releaseId);
    if (!id) throw new SourceError('unavailable', 'Неверный релиз');
    for (const country of countries()) {
      const found = parseAlbumLookup(await get(releaseUrl(id, country)), id);
      if (found) return found;
    }
    throw new SourceError('unavailable', 'Треки этого релиза не нашлись');
  }

  const release = async (releaseId: string): Promise<Track[]> => (await album(releaseId)).tracks;

  /**
   * Исполнители чарта своей страны: один запрос чарта (это не каталог — лимит частоты его не касается), фото — по именам.
   * Не ответил чарт — ошибка (пустое не кэшируется).
   */
  function popular(): Promise<PopularArtist[]> {
    const country = (deps.country ?? currentCountry)();
    if (popularCache && popularCache.country === country && now() - popularCache.at < POPULAR_TTL_MS) return Promise.resolve(popularCache.list);
    if (popularLoading?.country === country) return popularLoading.promise;
    const promise = (async () => {
      const found = parsePopularArtists(await get(popularUrl(country), 'background')).slice(0, POPULAR_LIMIT);
      if (found.length === 0) throw new SourceError('unavailable', 'Популярное сейчас пока пусто — попробуй позже');
      const list: PopularArtist[] = [];
      for (const part of chunks(found, POPULAR_PICTURES_AT_ONCE)) {
        const withPictures = await Promise.all(
          part.map(async (a) => {
            const imageUrl = await pictureOf(a.name);
            return imageUrl ? { ...a, imageUrl } : a;
          }),
        );
        list.push(...withPictures);
      }
      await saveCache();
      popularCache = { country, at: now(), list };
      return list;
    })().finally(() => {
      if (popularLoading?.promise === promise) popularLoading = null;
    });
    popularLoading = { country, promise };
    return promise;
  }

  /**
   * id похожих артистов в каталоге по именам (кэш). Фоновые запросы ждут своей очереди в ограничителе частоты;
   * не нашёлся один — следующий; каталог перестал отвечать совсем — берём то, что нашлось.
   */
  async function catalogIds(names: { name: string; genre?: string }[], budgetMs = Infinity): Promise<Map<string, string>> {
    const c = await loadCache();
    const out = new Map<string, string>();
    const deadline = Date.now() + budgetMs;
    let failuresInRow = 0;
    for (const { name, genre } of names) {
      const key = normalizeText(name);
      const known = c.catalog.get(key);
      // Старые записи могли запомнить тёзку с похожим именем — такие спрашиваются заново.
      if (fresh(known) && (!known.id || !known.name || artistKey(known.name) === key)) {
        if (known.id) out.set(key, known.id);
        continue;
      }
      // Срок вышел — остальные спросит следующая сборка (найденные уже в кэше).
      const left = deadline - Date.now();
      if (left <= 0) break;
      let found: CatalogArtist | null;
      try {
        found = await withTimeout(catalogArtistByName(name, genre, countries().slice(0, 1), 'background'), left, 'Каталог не ответил вовремя');
        failuresInRow = 0;
      } catch (err) {
        if (isOffline(err)) throw err;
        if (Date.now() >= deadline || ++failuresInRow >= CATALOG_FAILURES_IN_ROW) break;
        continue; // не запоминаем: следующая сборка спросит снова
      }
      c.catalog.set(key, found ? { id: found.id, name: found.name, at: now() } : { id: null, at: now() });
      dirty = true;
      if (found) out.set(key, found.id);
    }
    return out;
  }

  async function buildFeed(followed: readonly FollowedArtist[], onFollowed?: (followed: ArtistRelease[]) => void): Promise<ArtistFeedData> {
    const followedIds = [...new Set(followed.map((a) => a.id).filter(Boolean))];
    if (followedIds.length === 0) return { followed: [], similar: [], followedIds };
    const t = now();
    const since = sinceDate(t, FEED_FOLLOWED_DAYS);
    const fallbackSince = sinceDate(t, FEED_FOLLOWED_FALLBACK_DAYS);
    const similarSince = sinceDate(t, FEED_SIMILAR_DAYS);

    // 1. Релизы подписок.
    const groups = await withTimeout(albumsOf(followedIds, 'background'), feedTimeouts.followedMs, 'Каталог не отдал релизы подписок вовремя');
    const followedReleases: ArtistRelease[] = [];
    const taken = new Set<string>();
    const genres = new Map<string, string | undefined>();
    for (const a of followed) {
      const g = groups.get(a.id);
      if (!g) continue;
      genres.set(a.id, g.artist.genre);
      const all = selectReleases(g.collections, { id: a.id, name: g.artist.name || a.name });
      let recent = all.filter((r) => r.releaseDate >= since);
      if (recent.length === 0) recent = all.filter((r) => r.releaseDate >= fallbackSince).slice(0, FEED_FOLLOWED_FALLBACK_COUNT);
      for (const r of recent) {
        if (taken.has(r.id)) continue;
        taken.add(r.id);
        followedReleases.push(r);
      }
    }
    const byDate = (a: ArtistRelease, b: ArtistRelease) => (a.releaseDate === b.releaseDate ? 0 : a.releaseDate < b.releaseDate ? 1 : -1);
    const followedFeed = followedReleases.sort(byDate).slice(0, FEED_FOLLOWED_LIMIT);
    onFollowed?.(followedFeed);

    // 2. Похожие на подписки (сами подписки исключены): поровну на каждую подписку (свежие подписки — первыми,
    // лимит их не отрезает), не больше 5 на подписку и 40 всего.
    const followedNames = new Set(followed.map((a) => normalizeText(a.name)));
    const order = [...followed].sort((a, b) => (b.followedAt ?? 0) - (a.followedAt ?? 0)).slice(0, SIMILAR_MAX_ARTISTS);
    type Candidate = { name: string; genre?: string; to: ArtistRef };
    const perFollowed: Candidate[][] = [];
    for (const part of chunks(order, RELATED_AT_ONCE)) {
      const lists = await Promise.all(
        part.map(async (a): Promise<Candidate[]> => {
          let list: DeezerArtist[] = [];
          try {
            list = await withTimeout(
              deezerArtist(a.name).then((dz) => (dz?.id ? relatedOf(dz.id) : [])),
              feedTimeouts.relatedMs,
              'Похожие не нашлись вовремя',
            );
          } catch (err) {
            if (isOffline(err)) throw err;
          }
          return list
            .filter((s) => !followedNames.has(normalizeText(s.name)))
            .map((s) => ({ name: s.name, genre: genres.get(a.id), to: { id: a.id, name: a.name } }));
        }),
      );
      perFollowed.push(...lists);
    }
    const candidates = roundRobin(perFollowed, (c) => normalizeText(c.name), similarPerFollowed(order.length), SIMILAR_MAX_ARTISTS);

    const ids = await catalogIds(candidates, feedTimeouts.idsBudgetMs);
    const similarTo = new Map<string, { id: string; name: string }>();
    for (const c of candidates) {
      const id = ids.get(normalizeText(c.name));
      if (id && !followedIds.includes(id) && !similarTo.has(id)) similarTo.set(id, c.to);
    }

    // Релизы похожих — по подпискам, к которым они похожи: «Свежее от похожих» тоже делится поровну.
    const byFollowed = new Map<string, ArtistRelease[]>();
    if (similarTo.size > 0) {
      const similarGroups = await withTimeout(albumsOf([...similarTo.keys()], 'background'), feedTimeouts.similarMs, 'Каталог не отдал релизы похожих вовремя').catch(
        (err: unknown) => {
          if (isOffline(err)) throw err;
          return new Map<string, ArtistAlbums>();
        },
      );
      for (const [id, to] of similarTo) {
        const g = similarGroups.get(id);
        if (!g) continue;
        const fresh = selectReleases(g.collections, g.artist)
          .filter((r) => r.releaseDate >= similarSince && !taken.has(r.id))
          .filter((r) => !g.collections.some((c) => c.id === r.id && followedIds.includes(c.artistId)))
          .slice(0, SIMILAR_RELEASES_PER_ARTIST);
        const list = byFollowed.get(to.id) ?? [];
        for (const r of fresh) {
          taken.add(r.id);
          list.push({ ...r, similarTo: to });
        }
        byFollowed.set(to.id, list);
      }
    }
    await saveCache();

    const fairLists = order.map((a) => (byFollowed.get(a.id) ?? []).sort(byDate));
    const similar = roundRobin(fairLists, (r) => r.id, FEED_SIMILAR_LIMIT, FEED_SIMILAR_LIMIT);
    return { followed: followedFeed, similar: similar.sort(byDate), followedIds };
  }

  return { search, page, release, album, popular, buildFeed };
}

export const artists = createArtistsService();
