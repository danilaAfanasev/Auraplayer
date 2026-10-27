// «Популярное сейчас»: кэш чарта в charts.json (userData) и расписание обновления — при запуске
// и каждые 6 часов. Без сети остаётся последний сохранённый список с пометкой об ошибке.
// Поля «Новинок» из файлов прошлых версий (`newReleases`, `yearReleases`) игнорируются.
// Тот же сервис и то же расписание ведут ленту артистов («Новое от моих артистов», «Свежее от похожих»):
// кэш — artist-feed.json, без сети остаётся сохранённая лента.
// Модуль не импортирует electron: чтение/запись/рассылку задаёт src/main/ipc/charts.ts.
import type { ArtistFeedSnapshot, ChartsSnapshot } from '../shared/api';
import { cleanRelease } from '../shared/release';
import { CHART_COUNTRIES, makeTrackId, type ArtistRelease, type CountryCode, type Track } from '../shared/types';
import type { ArtistFeedData } from './sources/artists';
import type { CatalogLists } from './sources/catalog';
import { classifyFetchError } from './sources/http';
import { SOURCE_ERROR_MESSAGES, SourceError } from './sources/types';

export const CHARTS_FILE = 'charts.json';
export const CHARTS_REFRESH_MS = 6 * 3600_000;
export const ARTIST_FEED_FILE = 'artist-feed.json';

export interface ChartsCache {
  version: 1;
  updatedAt: number;
  chart: Track[];
  /** Страна чарта; нет в файле прошлой версии. */
  country?: CountryCode;
}

export interface ArtistFeedCache extends ArtistFeedData {
  version: 1;
  updatedAt: number;
}

export interface ArtistFeedDeps {
  /** Собрать ленту по текущим подпискам; `onFollowed` — релизы подписок готовы раньше похожих. */
  load(onFollowed: (followed: ArtistRelease[]) => void): Promise<ArtistFeedData>;
  read(): Promise<unknown>;
  write(data: ArtistFeedCache): Promise<void>;
  emit(s: ArtistFeedSnapshot): void;
}

export interface ChartsServiceDeps {
  /** Скачать свежий чарт (fetchCatalog) — для страны, выбранной на момент вызова. */
  load(): Promise<CatalogLists>;
  /**
   * Страна чарта, выбранная сейчас. Есть — «Обновить» во время идущего обновления для другой страны
   * ставит обновление следом, а не возвращает идущее (оно скачивает прежнюю страну).
   */
  country?: () => CountryCode;
  read(): Promise<unknown>;
  write(data: ChartsCache): Promise<void>;
  /** Рассылка снимка в окна после каждого изменения. */
  emit(s: ChartsSnapshot): void;
  now?: () => number;
  intervalMs?: number;
  /** Лента артистов — по тому же расписанию. */
  feed?: ArtistFeedDeps;
  /** Сборка ленты дольше этого — сбой (по умолчанию `FEED_BUILD_TIMEOUT_MS`). */
  feedTimeoutMs?: number;
  /** Сбой сборки ленты — повтор через столько (по умолчанию `FEED_RETRY_MS`). */
  feedRetryMs?: number;
}

/** Сборка ленты не держит следующие пересборки дольше этого: каждый её шаг со своим сроком, а это — общий. */
export const FEED_BUILD_TIMEOUT_MS = 12 * 60_000;
/** Сборка ленты сорвалась — сама повторяется через столько (не через 6 часов), подряд — не больше `FEED_RETRIES`. */
export const FEED_RETRY_MS = 2 * 60_000;
export const FEED_RETRIES = 3;
export const FEED_TIMEOUT_MESSAGE = 'Лента собиралась слишком долго';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Трек каталога из кэша: только известные поля, id согласован с источником. */
function cleanTrack(v: unknown): Track | null {
  if (!isObject(v) || v.source !== 'catalog' || !nonEmpty(v.sourceId) || !nonEmpty(v.title) || !nonEmpty(v.artist)) return null;
  if (v.id !== makeTrackId('catalog', v.sourceId)) return null;
  const t: Track = { id: v.id, source: 'catalog', sourceId: v.sourceId, title: v.title, artist: v.artist, downloadable: true };
  if (nonEmpty(v.album)) t.album = v.album;
  if (typeof v.durationSec === 'number' && Number.isFinite(v.durationSec) && v.durationSec > 0) t.durationSec = v.durationSec;
  if (nonEmpty(v.coverUrl) && v.coverUrl.startsWith('https://')) t.coverUrl = v.coverUrl;
  if (nonEmpty(v.pageUrl) && v.pageUrl.startsWith('https://')) t.pageUrl = v.pageUrl;
  return t;
}

/** Содержимое charts.json → кэш; повреждённое или чужое — null. */
export function normalizeChartsCache(raw: unknown): ChartsCache | null {
  if (!isObject(raw) || raw.version !== 1 || typeof raw.updatedAt !== 'number') return null;
  if (!Array.isArray(raw.chart)) return null;
  const chart = raw.chart.map(cleanTrack).filter((t): t is Track => t !== null);
  const country = CHART_COUNTRIES.find((c) => c.code === raw.country)?.code;
  return { version: 1, updatedAt: raw.updatedAt, chart, ...(country ? { country } : {}) };
}

const digits = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

/** Содержимое artist-feed.json → лента; повреждённое — null. */
export function normalizeFeedCache(raw: unknown): ArtistFeedCache | null {
  if (!isObject(raw) || raw.version !== 1 || typeof raw.updatedAt !== 'number') return null;
  if (!Array.isArray(raw.followed) || !Array.isArray(raw.similar)) return null;
  const releases = (list: unknown[]) => list.map(cleanRelease).filter((r): r is ArtistRelease => r !== null);
  const followedIds = Array.isArray(raw.followedIds) ? raw.followedIds.filter(digits) : [];
  return { version: 1, updatedAt: raw.updatedAt, followed: releases(raw.followed), similar: releases(raw.similar), followedIds };
}

function toError(err: unknown): NonNullable<ChartsSnapshot['error']> {
  const e = err instanceof SourceError ? err : classifyFetchError(err);
  return { kind: e.kind, message: e.kind === 'offline' ? SOURCE_ERROR_MESSAGES.offline : e.message };
}

export interface ChartsService {
  snapshot(): Promise<ChartsSnapshot>;
  refresh(): Promise<ChartsSnapshot>;
  /** Лента артистов (из кэша, пока идёт обновление). */
  feedSnapshot(): Promise<ArtistFeedSnapshot>;
  /** Собрать ленту заново; во время сборки — ещё один проход после неё (подписки могли измениться). */
  refreshFeed(): Promise<ArtistFeedSnapshot>;
  /** Обновить сейчас и затем каждые `intervalMs`. */
  start(): void;
  stop(): void;
}

export function createChartsService(deps: ChartsServiceDeps): ChartsService {
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? CHARTS_REFRESH_MS;
  let cache: ChartsCache | null = null;
  let loaded: Promise<void> | null = null;
  let inflight: Promise<ChartsSnapshot> | null = null;
  /** Сверка страны после идущего обновления (и обновление для новой, если её сменили, пока оно шло). */
  let again: Promise<ChartsSnapshot> | null = null;
  let error: ChartsSnapshot['error'] = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const ensureLoaded = () =>
    (loaded ??= deps
      .read()
      .then((raw) => {
        // Удачное обновление могло прийти раньше чтения файла — оно новее.
        cache ??= normalizeChartsCache(raw);
      })
      .catch(() => undefined));

  const current = (): ChartsSnapshot => ({
    updatedAt: cache?.updatedAt ?? null,
    chart: cache?.chart ?? [],
    ...(cache?.country ? { country: cache.country } : {}),
    refreshing: inflight !== null,
    error,
  });

  /** Рассылка снимка не должна обрывать обновление (иначе `inflight` остался бы навсегда). */
  const safeEmit = (emit: (s: never) => void, s: unknown) => {
    try {
      (emit as (s: unknown) => void)(s);
    } catch {
      // окно закрылось посреди рассылки — снимок получит следующее
    }
  };

  async function doRefresh(): Promise<ChartsSnapshot> {
    try {
      await ensureLoaded();
      safeEmit(deps.emit, current());
      const { chart, country } = await deps.load();
      cache = { version: 1, updatedAt: now(), chart, ...(country ? { country } : {}) };
      error = null;
      await deps.write(cache).catch(() => undefined);
    } catch (err) {
      error = toError(err);
    } finally {
      inflight = null;
    }
    const snap = current();
    safeEmit(deps.emit, snap);
    return snap;
  }

  function refresh(): Promise<ChartsSnapshot> {
    if (!inflight) {
      inflight = doRefresh();
      return inflight;
    }
    if (again || !deps.country) return again ?? inflight;
    // Идущее могло начаться для прежней страны — после него сверяем страну, которую оно правда скачало
    // (на старте настройки могли быть ещё не прочитаны), с выбранной сейчас; другая — сразу обновление для неё,
    // та же (или переключили туда и обратно) — второй раз не скачиваем.
    again = inflight.then((snap) => {
      again = null;
      const country = deps.country?.();
      return country === undefined || (country === snap.country && !snap.error) ? snap : refresh();
    });
    return again;
  }

  // ---------- лента артистов ----------
  const feed = deps.feed;
  let feedCache: ArtistFeedCache | null = null;
  /** Релизы подписок нового прохода, пока похожие ещё собираются. */
  let feedPartial: ArtistRelease[] | null = null;
  let feedLoaded: Promise<void> | null = null;
  let feedInflight: Promise<ArtistFeedSnapshot> | null = null;
  let feedAgain: Promise<ArtistFeedSnapshot> | null = null;
  let feedError: ArtistFeedSnapshot['error'] = null;
  /** Номер сборки: релизы подписок от брошенной (зависшей) сборки не показываются. */
  let feedGeneration = 0;

  const ensureFeedLoaded = () =>
    (feedLoaded ??= (feed ? feed.read() : Promise.resolve(null))
      .then((raw) => {
        feedCache ??= normalizeFeedCache(raw);
      })
      .catch(() => undefined));

  const currentFeed = (): ArtistFeedSnapshot => ({
    updatedAt: feedCache?.updatedAt ?? null,
    followed: feedPartial ?? feedCache?.followed ?? [],
    similar: feedCache?.similar ?? [],
    followedIds: feedCache?.followedIds ?? [],
    refreshing: feedInflight !== null,
    error: feedError,
  });

  const feedTimeoutMs = deps.feedTimeoutMs ?? FEED_BUILD_TIMEOUT_MS;
  const feedRetryMs = deps.feedRetryMs ?? FEED_RETRY_MS;
  let feedRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let feedFailures = 0;

  /**
   * Одна сборка ленты. Что бы ни случилось — сбой, зависший шаг, ошибка рассылки — `feedInflight` снимается:
   * иначе все следующие пересборки (подписка, «Обновить», расписание) ждали бы за ней вечно.
   */
  async function doRefreshFeed(): Promise<ArtistFeedSnapshot> {
    try {
      await ensureFeedLoaded();
      if (!feed) return currentFeed();
      const generation = ++feedGeneration;
      safeEmit(feed.emit, currentFeed());
      const load = feed.load((followed) => {
        if (generation !== feedGeneration) return;
        feedPartial = followed;
        safeEmit(feed.emit, currentFeed());
      });
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(() => reject(new SourceError('unavailable', FEED_TIMEOUT_MESSAGE)), feedTimeoutMs);
      });
      const data = await Promise.race([load, deadline]).finally(() => clearTimeout(deadlineTimer));
      feedCache = { version: 1, updatedAt: now(), followed: data.followed, similar: data.similar, followedIds: data.followedIds };
      feedError = null;
      feedFailures = 0;
      await feed.write(feedCache).catch(() => undefined);
    } catch (err) {
      feedError = toError(err);
      scheduleFeedRetry();
    } finally {
      // Зависшая сборка дорабатывает в фоне, но её «релизы подписок» уже не показываются.
      feedGeneration++;
      feedPartial = null;
      feedInflight = null;
    }
    const snap = currentFeed();
    if (feed) safeEmit(feed.emit, snap);
    return snap;
  }

  /** Сбой — ещё попытка через пару минут (подряд — не больше `FEED_RETRIES`), пока сервис запущен. */
  function scheduleFeedRetry(): void {
    if (!timer || feedRetryTimer || ++feedFailures > FEED_RETRIES) return;
    feedRetryTimer = setTimeout(() => {
      feedRetryTimer = null;
      void runFeed();
    }, feedRetryMs);
  }

  /** Сборка (или ещё один проход после идущей). Автоповтор зовёт её напрямую — его серия сбоев продолжается. */
  function runFeed(): Promise<ArtistFeedSnapshot> {
    if (feedRetryTimer) {
      clearTimeout(feedRetryTimer);
      feedRetryTimer = null;
    }
    if (!feedInflight) return (feedInflight = doRefreshFeed());
    // Уже собирается — по старым подпискам. Ещё один проход после текущего (один на все такие вызовы).
    feedAgain ??= feedInflight.then(() => {
      feedAgain = null;
      return runFeed();
    });
    return feedAgain;
  }

  /**
   * Сборка по просьбе: «Повторить»/«Обновить», смена подписок, расписание. Это новая серия — лимит автоповторов
   * (`FEED_RETRIES`) считается заново: прошлые сбои процесса его не исчерпывают.
   */
  function refreshFeed(): Promise<ArtistFeedSnapshot> {
    feedFailures = 0;
    return runFeed();
  }

  return {
    refresh,
    refreshFeed,

    async feedSnapshot() {
      await ensureFeedLoaded();
      if (feed && !feedInflight && feedCache && now() - feedCache.updatedAt > intervalMs) void refreshFeed();
      return currentFeed();
    },

    async snapshot() {
      await ensureLoaded();
      // Компьютер спал дольше расписания — список устарел: обновляем в фоне.
      if (!inflight && cache && now() - cache.updatedAt > intervalMs) void refresh();
      return current();
    },

    start() {
      if (timer) return;
      const tick = () => {
        void refresh();
        if (feed) void refreshFeed();
      };
      tick();
      timer = setInterval(tick, intervalMs);
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (feedRetryTimer) clearTimeout(feedRetryTimer);
      feedRetryTimer = null;
    },
  };
}
