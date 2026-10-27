import type {
  AlbumPage,
  ArtistPage,
  ArtistRef,
  ArtistRelease,
  CountryCode,
  DownloadRecord,
  DownloadState,
  LibraryData,
  PopularArtist,
  Settings,
  SourceErrorKind,
  SourceId,
  SourceResult,
  Track,
} from './types';

export type MediaKey = 'play-pause' | 'next' | 'prev';

export interface YtDlpStatus {
  installed: boolean;
  version: string | null;
  /** Фоновая установка при запуске: идёт или не удалась (нет сети). Нет поля — ничего не происходит. */
  install?: 'running' | 'failed';
}

export interface YtDlpProgress {
  stage: string;
  progress: number;
}

/** «Популярное сейчас»: последний сохранённый список и состояние обновления. */
export interface ChartsSnapshot {
  /** Когда список последний раз удачно обновился; null — ещё ни разу. */
  updatedAt: number | null;
  /** Песни чарта страны в его порядке: позиция = индекс + 1. */
  chart: Track[];
  /** Страна этого чарта; нет — сохранён прошлой версией (тогда чарт был российский). */
  country?: CountryCode;
  /** Идёт обновление. */
  refreshing: boolean;
  /** Последнее обновление не удалось (например, нет сети) — показан сохранённый список. */
  error: { kind: SourceErrorKind; message: string } | null;
}

/** Лента артистов: «Новое от моих артистов» и «Свежее от похожих». Обновляется вместе с чартом. */
export interface ArtistFeedSnapshot {
  /** Когда лента последний раз удачно собрана; null — ещё ни разу. */
  updatedAt: number | null;
  /** Релизы подписок за последние ~90 дней, новые сверху. */
  followed: ArtistRelease[];
  /** Релизы артистов, похожих на подписки (сами подписки исключены), за ~60 дней, новые сверху. */
  similar: ArtistRelease[];
  /** Для каких подписок собрана лента (id каталога). */
  followedIds: string[];
  refreshing: boolean;
  /** Последнее обновление не удалось — показана сохранённая лента. */
  error: { kind: SourceErrorKind; message: string } | null;
}

/** Страница артиста: по id каталога или по имени (похожие артисты известны только по имени). */
export type ArtistQuery = { id: string } | { name: string };

/**
 * Текст ошибки страницы артиста, когда имени нет в каталоге точно (тёзки с похожим именем не подставляются):
 * по нему интерфейс открывает поиск по имени вместо страницы.
 */
export const CATALOG_ARTIST_NOT_FOUND = 'Артист не найден в каталоге';

/** Кто готовит звук заранее: плеер (текущий и следующие треки) или волна (проверка, что звук есть). */
export type PrepareOwner = 'player' | 'wave';

/** `fresh` — повторная попытка: не брать сохранённую ссылку на поток, запросить новую. */
export interface StreamOptions {
  fresh?: boolean;
  /** Проверить, что ссылка правда отдаёт звук (волна берёт в очередь только такие треки). */
  verify?: boolean;
}

/**
 * С чего начинается волна (бесконечные похожие треки). Похожие ищутся по трекам (YouTube Mix),
 * по артистам (их треки и радио похожих), по жанру (подборки по запросу) или по свободному тексту.
 */
export interface WaveSeed {
  /** Название волны в плеере: «Волна: <title>». */
  title: string;
  /** Играют первыми, в этом порядке (волна по треку — сам трек). Сервис их не возвращает. */
  lead?: Track[];
  /** Похожие на эти треки — их YouTube Mix; у треков SoundCloud — рекомендации SoundCloud. */
  tracks?: Track[];
  /** Артисты-сиды: их треки и радио похожих. */
  artists?: string[];
  /** Жанр или настроение: подборки по запросу («phonk», «хайперпоп»). */
  queries?: string[];
  /** «Своя волна»: артист, если такой нашёлся, иначе жанр. */
  text?: string;
  /** Свои треки сида, подмешиваются в первую порцию (волна по артисту — его популярные треки). */
  extra?: Track[];
}

/** Дополнение волны: `recent` — последние треки очереди, `round` — номер дополнения (чередует источники). */
export interface WaveMoreRequest {
  seed: WaveSeed;
  recent: Track[];
  round: number;
}

/** Списки раздела SoundCloud: «Популярное» — чарты SoundCloud, «Свежее» — новые и набирающие популярность. */
export type ScChartKind = 'top' | 'fresh';
/** Жанры переключателя раздела SoundCloud (`all` — все жанры). */
export const SC_GENRES = ['all', 'hiphop', 'electronic', 'pop', 'rnb'] as const;
export type ScGenre = (typeof SC_GENRES)[number];
/** Регионы чартов SoundCloud (`all` — США и Великобритания вместе; `ru` — из поиска, своего чарта нет). */
export const SC_REGIONS = ['all', 'us', 'uk', 'ru'] as const;
export type ScRegion = (typeof SC_REGIONS)[number];

export interface ScChartQuery {
  kind: ScChartKind;
  genre: ScGenre;
  region: ScRegion;
}

export interface ScChartResult {
  /** Только полные треки (без 30-секундных отрывков и DRM), в порядке чарта. */
  tracks: Track[];
  /** Когда самый старый из показанных списков удачно загружен; null — ещё ни разу. */
  updatedAt: number | null;
  /** Обновление не удалось (показан сохранённый список, если он есть) или SoundCloud выключен (`disabled`). */
  error: { kind: SourceErrorKind; message: string } | null;
}

/** Мост `window.aura`, который preload выставляет рендереру. */
export interface AuraApi {
  search(source: SourceId, query: string): Promise<SourceResult>;
  featured(source: SourceId): Promise<SourceResult>;
  byTag(source: SourceId, tag: string): Promise<SourceResult>;
  resolveStream(track: Track, opts?: StreamOptions): Promise<string>; // для скачанного трека — aura-media:// URL файла
  /**
   * Подготовить звук заранее (найти и получить ссылку, не играя): `tracks` — что владельцу нужно скоро, по порядку
   * важности (не больше 4). Новый вызов заменяет набор владельца; подготовки, которые больше никому не нужны,
   * отменяются. Готовое потом отдаёт `resolveStream` сразу.
   */
  prepareStreams(owner: PrepareOwner, tracks: Track[]): Promise<void>;
  library: { load(): Promise<LibraryData>; save(lib: LibraryData): Promise<void> };
  settings: { load(): Promise<Settings>; save(s: Settings): Promise<void> };
  downloads: {
    start(track: Track): Promise<void>;
    cancel(trackId: string): Promise<void>;
    list(): Promise<DownloadRecord[]>;
    remove(trackId: string): Promise<void>;
    onState(cb: (s: DownloadState) => void): () => void;
  };
  local: { pickFolder(): Promise<string | null>; rescan(): Promise<Track[]>; tracks(): Promise<Track[]> };
  ytdlp: {
    status(): Promise<YtDlpStatus>;
    update(): Promise<{ version: string }>;
    /** Скачать yt-dlp, если его нет (ошибка сети — исключение с понятным текстом). */
    install(): Promise<void>;
    onProgress(cb: (p: YtDlpProgress) => void): () => void;
  };
  charts: {
    /** Текущий снимок (из кэша `charts.json`, пока идёт обновление). */
    get(): Promise<ChartsSnapshot>;
    /** Обновить сейчас; возвращает снимок после обновления (при ошибке — сохранённый список с `error`). */
    refresh(): Promise<ChartsSnapshot>;
    /** Снимок после каждого изменения (начало/конец обновления). */
    onUpdate(cb: (s: ChartsSnapshot) => void): () => void;
  };
  artists: {
    /** Артисты по имени — карточки над результатами поиска (лучший первым). */
    search(query: string): Promise<ArtistRef[]>;
    page(query: ArtistQuery): Promise<ArtistPage>;
    /** Треки релиза по порядку (звук — как у каталога, с YouTube). */
    release(releaseId: string): Promise<Track[]>;
    /** Страница альбома: обложка, вид, год, треки по порядку, общая длительность. */
    album(releaseId: string): Promise<AlbumPage>;
    /** Исполнители «Популярного сейчас» своей страны с фото — подсказка «Подпишись на артистов» и первый запуск. */
    popular(): Promise<PopularArtist[]>;
    feed(): Promise<ArtistFeedSnapshot>;
    /** Собрать ленту заново по текущим подпискам из library.json. */
    refreshFeed(): Promise<ArtistFeedSnapshot>;
    onFeed(cb: (s: ArtistFeedSnapshot) => void): () => void;
  };
  soundcloud: {
    /**
     * Список раздела SoundCloud. Сохранённый список отдаётся сразу, если он свежее нескольких часов;
     * иначе (или с `force`) загружается заново. Без сети — сохранённый список с `error`.
     */
    chart(query: ScChartQuery, opts?: { force?: boolean }): Promise<ScChartResult>;
  };
  wave: {
    /** Первая порция похожих треков (без `seed.lead`) — кандидаты; отбор без дублей — у вызывающего. */
    start(seed: WaveSeed): Promise<Track[]>;
    /** Следующая порция: похожие на недавние треки и на сиды. */
    more(req: WaveMoreRequest): Promise<Track[]>;
  };
  pickDownloadDir(): Promise<string | null>;
  openExternal(url: string): Promise<void>; // только http(s)
  showInFolder(path: string): Promise<void>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    onMaximized(cb: (v: boolean) => void): () => void;
  };
  onMediaKey(cb: (k: MediaKey) => void): () => void;
  /**
   * Main перед закрытием окна вызывает `cb` и ждёт его завершения (не дольше нескольких секунд),
   * чтобы отложенные сохранения успели дописаться.
   */
  onBeforeClose(cb: () => Promise<void>): () => void;
}

/**
 * Ответ обработчика IPC. Main никогда не бросает исключение через границу:
 * ошибка приходит как `{ ok: false }` с человеческим текстом, preload превращает её в `Error`.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string; code?: string } };
