// Модель данных Aura — общая для main и renderer (без импорта electron/DOM).
import type { EqualizerSettings } from './equalizer';
import type { Blacklist } from './blacklist';
import type { CustomThumb, ThumbChoice } from './progressThumb';
import type { Taste } from './taste';

/**
 * `catalog` — чарт и каталог Apple Music (метаданные), звук которых находится на YouTube;
 * `soundcloud` — SoundCloud через yt-dlp, анонимно.
 */
export type SourceId = 'archive' | 'youtube' | 'soundcloud' | 'local' | 'catalog';

export interface Track {
  id: string; // `${source}:${sourceId}` — стабильный ключ во всех списках
  source: SourceId;
  sourceId: string; // id у источника; для local — абсолютный путь файла
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  coverUrl?: string; // http(s) или aura-media:// для локальных обложек
  downloadable: boolean; // разрешено ли скачивание (для local — false: файл уже на диске)
  pageUrl?: string; // страница трека у источника (открыть в браузере)
  tags?: string[];
  /** Официальное аудио: канал «… - Topic», «Provided to YouTube by…», «Official Audio». */
  official?: true;
}

export interface Playlist {
  id: string; // nanoid
  name: string;
  trackIds: string[]; // порядок = порядок в плейлисте, без дублей
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  trackId: string;
  playedAt: number;
}

/** Артист открытого каталога (тот же, что у треков `catalog`). `id` — id артиста в каталоге (цифры). */
export interface ArtistRef {
  id: string;
  name: string;
  /** Фото артиста (https) или обложка его свежего релиза. */
  imageUrl?: string;
}

/**
 * Карточка артиста в поиске. `id` каталога может быть ещё не известен (артист нашёлся по популярности, а не в каталоге):
 * тогда страница ищется по точному имени при клике.
 */
export interface ArtistCard {
  id?: string;
  name: string;
  imageUrl?: string;
}

/** Исполнитель «Популярного сейчас» своей страны — подсказки подписок и первый запуск. */
export interface PopularArtist extends ArtistRef {
  /** Жанры его песен в чарте — теги `GENRES` (`hiphop`, `pop`…). */
  tags?: string[];
}

/** Подписка на артиста в `library.json`. */
export interface FollowedArtist extends ArtistRef {
  followedAt: number;
}

export type ReleaseKind = 'album' | 'ep' | 'single';

/** Релиз артиста (альбом, EP, сингл) из каталога. Треки — `aura.artists.release(id)`. */
export interface ArtistRelease {
  /** id релиза (коллекции) в каталоге. */
  id: string;
  title: string;
  /** Исполнители релиза, как у каталога («madk1d & VILLIAN»). */
  artist: string;
  /** Артист, по которому релиз найден (подписка или похожий артист). */
  artistId: string;
  kind: ReleaseKind;
  /** `YYYY-MM-DD` */
  releaseDate: string;
  trackCount: number;
  coverUrl?: string;
  /** «Свежее от похожих»: подписка, на которую похож артист релиза. */
  similarTo?: { id: string; name: string };
}

/** Сохранённый альбом: снимок релиза (виден без сети) и когда его сохранили. Треки альбома в «Мне нравится» не попадают. */
export interface LikedAlbum {
  release: ArtistRelease;
  likedAt: number;
}

/** Другой артист каталога с тем же именем (переключатель на странице артиста): фото и жанр помогают их различить. */
export interface NamesakeRef extends ArtistRef {
  genre?: string;
}

/** Похожий артист (по открытому API похожих) — только имя и фото; страница открывается поиском по имени. */
export interface SimilarArtist {
  name: string;
  imageUrl?: string;
}

/** Страница альбома (релиза): метаданные — из обёртки коллекции того же lookup, что и треки. */
export interface AlbumPage {
  release: ArtistRelease;
  /** Треки по порядку (диск, номер). */
  tracks: Track[];
  /** Сумма длительностей треков, с. */
  durationSec: number;
}

/** Страница артиста. */
export interface ArtistPage {
  artist: ArtistRef & { genre?: string };
  /** Популярные треки (без диджейских миксов и сборников). */
  topTracks: Track[];
  /** Релизы от новых к старым, без миксов и чужих сборников. */
  releases: ArtistRelease[];
  similar: SimilarArtist[];
  /** Другие исполнители каталога с точно таким же именем (до 3) — только у страницы, открытой по имени. */
  namesakes?: NamesakeRef[];
}

export interface LibraryData {
  version: 1;
  tracks: Record<string, Track>; // снимок метаданных всех треков, упомянутых в плейлистах/лайках/истории
  playlists: Playlist[];
  likes: string[]; // trackId, новые — в начало
  history: HistoryEntry[]; // новые — в начало, не больше 100
  followedArtists: FollowedArtist[]; // подписки, новые — в начало
  /** Сохранённые альбомы (снимки релизов), новые — в начало. */
  likedAlbums: LikedAlbum[];
  /** Чёрный список: скрытые треки (со снимками) и исполнители. */
  blacklist: Blacklist;
  /** Вкус: журнал событий для скрытого рейтинга исполнителей и жанры пользователя. */
  taste: Taste;
}

export interface ThemeSettings {
  presetId: string | null; // null — свои цвета
  accent: string; // '#rrggbb'
  background: string; // '#rrggbb'
}

export type RepeatMode = 'off' | 'all' | 'one';

/** Страны чарта «Популярное сейчас» и поиска каталога. */
export type CountryCode = 'ru' | 'us' | 'gb' | 'de' | 'fr' | 'ua' | 'kz' | 'by';

export const CHART_COUNTRIES: readonly { code: CountryCode; name: string }[] = [
  { code: 'ru', name: 'Россия' },
  { code: 'us', name: 'США' },
  { code: 'gb', name: 'Великобритания' },
  { code: 'de', name: 'Германия' },
  { code: 'fr', name: 'Франция' },
  { code: 'ua', name: 'Украина' },
  { code: 'kz', name: 'Казахстан' },
  { code: 'by', name: 'Беларусь' },
];

/** Виды саундвейва: волны, квадратики, точки, зеркальная волна, кольцо, осциллограф. */
export const SOUNDWAVE_STYLES = ['waves', 'blocks', 'dots', 'mirror', 'ring', 'scope'] as const;
export type SoundwaveStyle = (typeof SOUNDWAVE_STYLES)[number];

export interface Settings {
  version: 1;
  theme: ThemeSettings;
  downloadDir: string; // по умолчанию <Музыка>\Aura
  youtubeEnabled: boolean; // по умолчанию true
  soundcloudEnabled: boolean; // по умолчанию true
  /** «Похожие после конца списка»: доиграла обычная очередь (повтор выключен) — дальше волна от последнего трека. По умолчанию true. */
  waveAfterQueue: boolean;
  localFolders: string[];
  volume: number; // 0..1
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  lastSession: { queue: string[]; index: number; positionSec: number } | null;
  /** Страна чарта и каталога: `'auto'` — как в системе. */
  chartCountry: 'auto' | CountryCode;
  /** Первый запуск пройден (или пропущен). Новый пользователь — false, старый файл без поля — true. */
  onboarded: boolean;
  /** Эквалайзер: выключен по умолчанию; полосы, пресет, предусиление, мои пресеты. */
  equalizer: EqualizerSettings;
  /** Саундвейв на фоне окна. По умолчанию true (и у старого файла без поля). */
  soundwave: boolean;
  /** Вид саундвейва. По умолчанию `'waves'` (и у старого файла без поля). */
  soundwaveStyle: SoundwaveStyle;
  /** Значок на полосе трека (панель плеера и экран текста); громкость — всегда кружок. По умолчанию кружок. */
  progressThumb: ThumbChoice;
  /** Нарисованные пользователем значки, до 12. */
  customThumbs: CustomThumb[];
}

export interface DownloadRecord {
  trackId: string;
  filePath: string;
  downloadedAt: number;
  track: Track;
}

export type DownloadState =
  | { trackId: string; status: 'queued' }
  | { trackId: string; status: 'downloading'; progress: number /*0..1, -1 неизвестно*/ }
  | { trackId: string; status: 'done'; filePath: string }
  | { trackId: string; status: 'error'; message: string }
  | { trackId: string; status: 'cancelled' };

export type SourceErrorKind = 'offline' | 'unavailable' | 'disabled' | 'unknown';

export interface SourceResult {
  source: SourceId;
  tracks: Track[];
  error?: { kind: SourceErrorKind; message: string };
}

export const SOURCE_IDS: readonly SourceId[] = ['archive', 'youtube', 'soundcloud', 'local', 'catalog'];

/** Короткие подписи источников — для маленьких меток у трека (`SourceBadge`). */
export const SOURCE_LABELS: Record<SourceId, string> = {
  archive: 'Archive',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  local: 'Файл',
  catalog: 'Каталог',
};

/** Полные названия источников — вкладки и разделы поиска, подборка на главной, подсказки. */
export const SOURCE_NAMES: Record<SourceId, string> = {
  archive: 'Internet Archive',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  local: 'Мои файлы',
  catalog: 'Каталог',
};

/** Звук трека каталога не нашёлся на YouTube. */
export const CATALOG_NOT_FOUND_MESSAGE = 'Не удалось найти звук для этого трека';
/** Трек каталога, а YouTube выключен в настройках: звук взять неоткуда. */
export const CATALOG_NEEDS_YOUTUBE_MESSAGE = 'Чтобы слушать треки каталога, включи YouTube в настройках';

export function makeTrackId(source: SourceId, sourceId: string): string {
  return `${source}:${sourceId}`;
}
