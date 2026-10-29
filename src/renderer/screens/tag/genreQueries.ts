// Страница жанра — свежая музыка: поиск YouTube и SoundCloud по жанру со свежим годом («рэп 2026», «hip hop 2026»)
// и «Волна: <жанр>». Старые подборки (Internet Archive) здесь не используются. Чистые функции — без DOM и сети.
import type { WaveSeed } from '../../../shared/api';
import { genreByTag, genreName } from '../../../shared/genres';
import { isLikelyTrack, LONG_TRACK_SEC } from '../../../shared/trackFilter';
import type { SourceId, SourceResult, Track } from '../../../shared/types';
import { songKey } from '../../../shared/wave';
import type { SourceStatus } from '../search/sourceQueries';

/** Свежих треков страницы — сидов волны жанра (их YouTube Mix). */
const WAVE_SEED_TRACKS = 10;
/** Песня длится не меньше минуты; верхний предел и слова «интервью/микс/…» — `isLikelyTrack`. */
const MIN_SONG_SEC = 60;
/** Год в названии старше прошлого — старый трек. */
const FRESH_YEARS = 1;

/** Основные слова жанра: первое русское и первое английское (`Genre.ru/en`); неизвестный тег — его подпись. */
function terms(tag: string): string[] {
  const g = genreByTag(tag);
  const list = g ? [g.ru[0], g.en[0]] : [genreName(tag)];
  return unique(list);
}

/** Сленг и другие названия сцены («drain rap», «pluggnb») — для волны жанра. */
function slang(tag: string): string[] {
  const g = genreByTag(tag);
  return g ? unique([...g.en.slice(1), ...g.ru.slice(1)]) : [];
}

function unique(list: readonly (string | undefined)[]): string[] {
  return [...new Set(list.map((s) => (s ?? '').trim()).filter(Boolean))];
}

/** Запросов у волны жанра — не больше стольких (каждый — подборки в открытом API). */
const WAVE_QUERIES = 6;

/** Поисковые запросы страницы жанра: русское и английское название со свежим годом. */
export function genreSearchQueries(tag: string, year: number): string[] {
  return terms(tag).map((term) => `${term} ${year}`);
}

/** Подборок каталога у страницы жанра — не больше стольких запросов. */
const PLAYLIST_QUERIES = 3;

/**
 * Запросы подборок каталога для страницы жанра: названия сцены без года — английские, затем русские. У редких жанров
 * поиск видео «<жанр> 2026» отдаёт почти одни миксы, а подборки по названию сцены — песни этого стиля.
 */
export function genrePlaylistQueries(tag: string): string[] {
  const g = genreByTag(tag);
  return g ? unique([...g.en, ...g.ru]).slice(0, PLAYLIST_QUERIES) : unique([genreName(tag)]);
}

/**
 * «Волна: <жанр>»: свежие подборки по жанру — по-русски и по-английски (зарубежное похожее тоже, G77), плюс
 * английское название и сленг сцены без года (редкие жанры: подборок «<жанр> <год>» почти нет); свежие треки страницы —
 * сиды и первые треки.
 */
export function genreWaveSeed(tag: string, year: number, fresh: readonly Track[]): WaveSeed {
  const [first, ...rest] = terms(tag);
  const queries = unique([
    `${first} ${year}`,
    `новый ${first}`,
    ...rest.map((term) => `${term} ${year}`),
    ...rest,
    ...slang(tag),
  ]).slice(0, WAVE_QUERIES);
  const seed: WaveSeed = { title: genreName(tag), queries };
  if (fresh.length > 0) {
    seed.tracks = fresh.slice(0, WAVE_SEED_TRACKS);
    seed.extra = fresh.slice();
  }
  return seed;
}

function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

/** Признаки подборок в нормализованном названии сверх общего правила `isLikelyTrack` (границы слов — пробелы). */
const NOT_A_SONG = [
  / (новинки|хиты) /,
  / \d+ ?минут /,
  // Ролики о сцене, а не её песни: видеоэссе, уроки, объявления (живая выдача редких жанров).
  / (explained|announcement|tutorial|type beat|placement loops) /,
  / (history of|how to make|in \d+ minutes|is ruining|died off|почему .* умер) /,
];

/**
 * Настоящие треки жанра бывают длинными (дрейн, эмбиент, пост-рок по 6–12 минут): до этой длины ролик — трек, если
 * по названию он не сборник и не микс; длиннее — только официальное аудио (`isLikelyTrack`).
 */
const GENRE_LONG_TRACK_SEC = 12 * 60;

function isFreshSong(track: Track, year: number): boolean {
  const d = track.durationSec;
  if (d !== undefined && d < MIN_SONG_SEC) return false;
  // Длина до 12 минут не делает трек «роликом»: остальные признаки (слова, часы в названии) проверяются как обычно.
  const asTrack = d !== undefined && d > LONG_TRACK_SEC && d <= GENRE_LONG_TRACK_SEC ? { ...track, durationSec: LONG_TRACK_SEC } : track;
  if (!isLikelyTrack(asTrack)) return false;
  const title = normalize(track.title);
  if (NOT_A_SONG.some((re) => re.test(title))) return false;
  const years = [...track.title.matchAll(/(?:^|\D)((?:19|20)\d\d)(?!\d)/g)].map((m) => Number(m[1]));
  return !years.some((y) => y < year - FRESH_YEARS);
}

/** Ответы запросов вперемешку: только песни, без старого года в названии, без повторов одной песни. */
export function freshGenreTracks(lists: readonly Track[][], year: number): Track[] {
  const mixed: Track[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) mixed.push(l[i]);
  // Одна песня один раз (по id и «исполнитель — название»); окно исполнителей волны здесь не нужно:
  // у редкой сцены несколько треков одного исполнителя — нормальная выдача.
  const ids = new Set<string>();
  const songs = new Set<string>();
  return mixed.filter((t) => {
    if (!isFreshSong(t, year)) return false;
    const song = songKey(t);
    if (ids.has(t.id) || songs.has(song)) return false;
    ids.add(t.id);
    songs.add(song);
    return true;
  });
}

/** Состояние раздела источника из нескольких запросов: треки — как только ответил хоть один. */
export function mergeGenreStatuses(source: SourceId, statuses: readonly (SourceStatus | undefined)[], year: number): SourceStatus | undefined {
  const results = statuses.filter((s): s is { status: 'done'; result: SourceResult } => s?.status === 'done').map((s) => s.result);
  const pending = results.length < statuses.length;
  const tracks = freshGenreTracks(
    results.filter((r) => !r.error).map((r) => r.tracks),
    year,
  );
  if (tracks.length > 0) return { status: 'done', result: { source, tracks } };
  if (pending) return { status: 'loading' };
  const failed = results.find((r) => r.error);
  if (failed && results.every((r) => r.error)) return { status: 'done', result: { source, tracks: [], error: failed.error } };
  return { status: 'done', result: { source, tracks: [] } };
}
