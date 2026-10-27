// Раздел SoundCloud: «Популярное» и «Свежее». Модуль не импортирует electron.
//
// Источник — официальные чарты SoundCloud: плейлисты аккаунтов music-charts-us и music-charts-uk (других регионов
// у SoundCloud нет). «Популярное» — топ жанра («All music genres», «Hip Hop», «Electronic»/«Dance», «Pop», «R&B»),
// «Свежее» — «New & Hot» (новые треки, которые быстро набирают прослушивания) и «Artist Pro» (новые независимые
// артисты); «Свежее» жанра — такие треки этого жанра (по жанру трека) и недавно загруженные треки чарта жанра.
// Чарта для России у SoundCloud нет: регион «Россия» — поиск SoundCloud по русским запросам жанра («русский рэп»,
// «рэп <год>»…), из выдачи — треки с кириллицей в названии или у исполнителя, по числу прослушиваний (`pickRussianTracks`).
// Треки грузит yt-dlp анонимно (`fetchScPlaylist`, `fetchScSearch`), отрывки и DRM отсеяны там же. Списки кэшируются в `soundcloud-charts.json` и обновляются при открытии раздела, если им больше
// SC_CHART_TTL_MS. Фоном ничего не грузится: SoundCloud при частых запросах отвечает 403.
import type { ScChartQuery, ScChartResult, ScGenre } from '../shared/api';
import { SOURCE_IDS, type SourceErrorKind, type SourceId, type Track } from '../shared/types';
import { artistKeys } from '../shared/wave';
import type { ScPlaylist } from './sources/soundcloud';
import { SourceError } from './sources/types';

export const SC_CHARTS_FILE = 'soundcloud-charts.json';
/** Сохранённый список старше этого обновляется при следующем открытии. */
export const SC_CHART_TTL_MS = 3 * 60 * 60_000;
export const SC_OFFLINE_MESSAGE = 'SoundCloud не отвечает — включи VPN и нажми «Повторить»';
const DISABLED_MESSAGE = 'SoundCloud выключен в настройках';
/**
 * Сколько списков SoundCloud грузится одновременно (каждый — процесс yt-dlp): вместе с волной и «Каталогом»
 * больше — риск 403. Остальные ждут в очереди.
 */
export const SC_LIST_CONCURRENCY = 2;
/** «Свежее» жанра берёт из чарта жанра треки, загруженные не раньше стольких дней назад. */
const FRESH_DAYS = 45;

type ChartSet = ScGenre | 'newHot' | 'artistPro';
type Region = 'us' | 'uk';

/** id списка-поиска (регион «Россия»): `search:<запрос>`; остальные id — плейлисты. */
export const SEARCH_ID_PREFIX = 'search:';
const DAY_MS = 24 * 60 * 60_000;
/** Популярное в России: загруженное за этот срок идёт раньше старого (иначе сверху — перезаливы 2016 года). */
const RU_RECENT_DAYS = 365;
/** Свежее в России: загруженное не раньше стольких дней назад. */
const RU_FRESH_DAYS = 60;
const RU_PER_ARTIST = 2;
const RU_LIMIT = 60;
const MIN_SONG_SEC = 60;
const MAX_SONG_SEC = 600;
const CYRILLIC = /[А-Яа-яЁё]/;

/** Русские запросы поиска для жанра (год — текущий). */
const RU_QUERIES: Record<ScGenre, (year: number) => string[]> = {
  all: (y) => ['русский рэп', `рэп ${y}`, `русская музыка ${y}`],
  hiphop: (y) => ['русский рэп', `рэп ${y}`, `новый рэп ${y}`],
  electronic: (y) => ['русская электроника', `электроника ${y}`, 'русский хаус'],
  pop: (y) => ['русская поп музыка', `поп ${y}`, `русские хиты ${y}`],
  rnb: (y) => ['русский r&b', `рнб ${y}`],
};

/** id плейлистов-чартов SoundCloud (стабильны: SoundCloud обновляет их содержимое на месте). */
const PLAYLISTS: Record<Region, Record<ChartSet, string>> = {
  us: {
    all: '1714689261',
    hiphop: '1714689219',
    electronic: '1714689240',
    pop: '1714689168',
    rnb: '1712717529',
    newHot: '1712717571',
    artistPro: '1712717550',
  },
  uk: {
    all: '1714689459',
    hiphop: '1714689438',
    electronic: '1714689441', // у Великобритании вместо «Electronic» — «Dance»
    pop: '1714689405',
    rnb: '1712718225',
    newHot: '1712718282',
    artistPro: '1712718252',
  },
};

/** Жанр трека SoundCloud (поле `genre` — свободный текст автора) → жанр переключателя. */
const GENRE_PATTERNS: Record<Exclude<ScGenre, 'all'>, RegExp> = {
  hiphop: /hip|rap|trap|drill|grime|рэп|хип/i,
  electronic: /electr|dance|house|techno|edm|dubstep|drum|bass|dnb|trance|riddim|garage|breaks|club|электр/i,
  pop: /pop|поп/i,
  rnb: /r\s*&\s*b|rnb|r'n'b|soul/i,
};

const regionsOf = (q: ScChartQuery): Region[] => (q.region === 'all' ? ['us', 'uk'] : q.region === 'ru' ? [] : [q.region]);
const ruSearchesOf = (q: ScChartQuery, now: number): string[] =>
  RU_QUERIES[q.genre](new Date(now).getFullYear()).map((query) => SEARCH_ID_PREFIX + query);

/** Плейлисты «набирающих популярность» для «Свежего». */
const trendingOf = (q: ScChartQuery): string[] => {
  const regions = regionsOf(q);
  return [...regions.map((r) => PLAYLISTS[r].newHot), ...regions.map((r) => PLAYLISTS[r].artistPro)];
};
/** Чарты жанра запроса (для «Свежего» жанра — источник недавно загруженных). */
const genreChartsOf = (q: ScChartQuery): string[] => regionsOf(q).map((r) => PLAYLISTS[r][q.genre]);

/** Все плейлисты, которые нужны запросу. */
export function chartPlaylists(q: ScChartQuery, now: number = Date.now()): string[] {
  if (q.region === 'ru') return ruSearchesOf(q, now);
  if (q.kind === 'top') return genreChartsOf(q);
  return q.genre === 'all' ? trendingOf(q) : [...trendingOf(q), ...genreChartsOf(q)];
}

/** Трек относится к жанру переключателя (по жанру, который указал автор). */
export function matchesGenre(track: Track, genre: ScGenre): boolean {
  if (genre === 'all') return true;
  return (track.tags ?? []).some((g) => GENRE_PATTERNS[genre].test(g));
}

/**
 * Популярное («top») или свежее («fresh») в России из выдачи поиска: только треки с кириллицей в названии или у
 * исполнителя, песни (1–10 мин), без повторных заливок (исполнитель + название), не больше двух у исполнителя,
 * по числу прослушиваний. Популярное: загруженное за последний год — раньше старого; свежее — только за ~2 месяца.
 */
export function pickRussianTracks(lists: ScPlaylist[], opts: { kind: ScChartQuery['kind']; now: number }): Track[] {
  const best = new Map<string, { t: Track; plays: number; at: number }>();
  const seen = new Set<string>();
  for (const l of lists) {
    for (const t of l.tracks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (!CYRILLIC.test(`${t.title} ${t.artist}`)) continue;
      const d = t.durationSec;
      if (d !== undefined && (d < MIN_SONG_SEC || d > MAX_SONG_SEC)) continue;
      const item = { t, plays: l.plays[t.sourceId] ?? 0, at: l.createdAt[t.sourceId] ?? 0 };
      const key = `${artistKeys(t.artist).join(' ')}|${t.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      const prev = best.get(key);
      if (!prev || item.plays > prev.plays) best.set(key, item);
    }
  }
  const byPlays = (a: { plays: number }, b: { plays: number }) => b.plays - a.plays;
  const all = [...best.values()];
  const ordered =
    opts.kind === 'fresh'
      ? all.filter((x) => x.at >= opts.now - RU_FRESH_DAYS * DAY_MS).sort(byPlays)
      : [
          ...all.filter((x) => x.at >= opts.now - RU_RECENT_DAYS * DAY_MS).sort(byPlays),
          ...all.filter((x) => x.at < opts.now - RU_RECENT_DAYS * DAY_MS).sort(byPlays),
        ];
  const perArtist = new Map<string, number>();
  const out: Track[] = [];
  for (const { t } of ordered) {
    const artist = artistKeys(t.artist)[0] ?? '';
    const n = perArtist.get(artist) ?? 0;
    if (n >= RU_PER_ARTIST) continue;
    perArtist.set(artist, n + 1);
    out.push(t);
    if (out.length >= RU_LIMIT) break;
  }
  return out;
}

/** Списки вперемешку по одному, без повторов. */
function interleave(lists: Track[][]): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const t = l[i];
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}

interface CachedList {
  at: number;
  tracks: Track[];
  /** Дата загрузки трека на SoundCloud по id (мс). */
  createdAt: Record<string, number>;
  /** Прослушивания трека по id. */
  plays: Record<string, number>;
}

interface CacheFile {
  version: 1;
  lists: Record<string, CachedList>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isTrack = (t: unknown): t is Track =>
  isObject(t) &&
  typeof t.id === 'string' &&
  typeof t.sourceId === 'string' &&
  typeof t.title === 'string' &&
  typeof t.artist === 'string' &&
  SOURCE_IDS.includes(t.source as SourceId);

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObject(v)) for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  return out;
}

function normalizeCache(raw: unknown): Record<string, CachedList> {
  const out: Record<string, CachedList> = {};
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.lists)) return out;
  for (const [id, v] of Object.entries(raw.lists)) {
    if (!isObject(v) || typeof v.at !== 'number' || !Array.isArray(v.tracks)) continue;
    out[id] = { at: v.at, tracks: v.tracks.filter(isTrack), createdAt: numbers(v.createdAt), plays: numbers(v.plays) };
  }
  return out;
}

/** Ошибка загрузки → текст для раздела: сбой сети и «не отвечает» — просьба включить VPN. */
function chartError(err: unknown): { kind: SourceErrorKind; message: string } {
  if (err instanceof SourceError) {
    const slow = err.kind === 'offline' || err.kind === 'unknown' || /не отвечает|не ответил/i.test(err.message);
    return { kind: err.kind, message: slow ? SC_OFFLINE_MESSAGE : err.message };
  }
  return { kind: 'unknown', message: SC_OFFLINE_MESSAGE };
}

export interface ScChartsDeps {
  /** Полные треки плейлиста SoundCloud (`fetchScPlaylist`) или поиска для id `search:<запрос>` (`fetchScSearch`). */
  load(playlistId: string): Promise<ScPlaylist>;
  read(): Promise<unknown>;
  write(data: CacheFile): Promise<void>;
  /** SoundCloud включён в настройках. */
  enabled(): Promise<boolean>;
  now?: () => number;
}

export interface ScChartsService {
  get(query: ScChartQuery, opts?: { force?: boolean }): Promise<ScChartResult>;
}

export function createScChartsService(deps: ScChartsDeps): ScChartsService {
  const now = deps.now ?? Date.now;
  /** Кэш читается из файла один раз: одновременные первые запросы делят один объект. */
  let cache: Promise<Record<string, CachedList>> | null = null;
  const inflight = new Map<string, Promise<void>>();
  /** Очередь загрузок: id в порядке запуска; пуск — по сигналу из `starters`. */
  const waiting: string[] = [];
  const starters = new Map<string, () => void>();
  let running = 0;

  function loadCache(): Promise<Record<string, CachedList>> {
    cache ??= deps.read().then(normalizeCache, () => normalizeCache(null));
    return cache;
  }

  function pump(): void {
    while (running < SC_LIST_CONCURRENCY && waiting.length > 0) {
      const id = waiting.shift()!;
      const start = starters.get(id);
      starters.delete(id);
      if (!start) continue;
      running++;
      start();
    }
  }

  /** Загрузка плейлиста, ждущая места в очереди; удача — в кэш и в файл. */
  function job(id: string): Promise<void> {
    const p = new Promise<void>((resolve) => starters.set(id, resolve))
      .then(async () => {
        try {
          const { tracks, createdAt, plays } = await deps.load(id);
          const lists = await loadCache();
          lists[id] = { at: now(), tracks, createdAt, plays };
          await deps.write({ version: 1, lists }).catch(() => undefined);
        } finally {
          running--;
          pump();
        }
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  /**
   * Загрузить плейлисты (один на id одновременно, не больше SC_LIST_CONCURRENCY сразу). Запрошенное последним —
   * то, что пользователь смотрит сейчас, — встаёт в начало очереди, перед списками прошлых запросов.
   */
  function refresh(ids: string[]): Promise<void>[] {
    const jobs = ids.map((id) => inflight.get(id) ?? job(id));
    const queued = ids.filter((id) => starters.has(id));
    for (const id of queued) {
      const i = waiting.indexOf(id);
      if (i >= 0) waiting.splice(i, 1);
    }
    waiting.unshift(...queued);
    pump();
    return jobs;
  }

  return {
    async get(query, opts = {}) {
      if (!(await deps.enabled())) return { tracks: [], updatedAt: null, error: { kind: 'disabled', message: DISABLED_MESSAGE } };
      const ids = chartPlaylists(query, now());
      const lists = await loadCache();
      let error: ScChartResult['error'] = null;
      const stale = ids.filter((id) => {
        const saved = lists[id];
        return !saved || opts.force || now() - saved.at >= SC_CHART_TTL_MS;
      });
      await Promise.all(
        refresh(stale).map((p) =>
          p.catch((err: unknown) => {
            error ??= chartError(err);
          }),
        ),
      );
      const listsOf = (from: string[]): CachedList[] => from.map((id) => lists[id]).filter((l): l is CachedList => !!l);
      const present = listsOf(ids);
      let tracks: Track[];
      if (query.region === 'ru') tracks = pickRussianTracks(present, { kind: query.kind, now: now() });
      else if (query.kind === 'top') tracks = interleave(listsOf(ids).map((l) => l.tracks));
      else {
        const trending = interleave(listsOf(trendingOf(query)).map((l) => l.tracks)).filter((t) => matchesGenre(t, query.genre));
        // Жанр: ещё и недавно загруженные треки его чарта, новые раньше.
        const since = now() - FRESH_DAYS * 24 * 60 * 60_000;
        const recent =
          query.genre === 'all'
            ? []
            : listsOf(genreChartsOf(query))
                .flatMap((l) => l.tracks.map((t) => ({ t, at: l.createdAt[t.sourceId] ?? 0 })))
                .filter((x) => x.at >= since)
                .sort((a, b) => b.at - a.at)
                .map((x) => x.t);
        tracks = interleave([trending, recent]);
      }
      const updatedAt = present.length > 0 ? Math.min(...present.map((l) => l.at)) : null;
      return { tracks, updatedAt, error };
    },
  };
}
