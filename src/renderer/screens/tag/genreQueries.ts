// Страница жанра — свежая музыка: поиск YouTube и SoundCloud по жанру со свежим годом («рэп 2026», «hip hop 2026»)
// и «Волна: <жанр>». Старые подборки (Internet Archive) здесь не используются. Чистые функции — без DOM и сети.
import type { WaveSeed } from '../../../shared/api';
import { genreName } from '../../../shared/genres';
import { isLikelyTrack } from '../../../shared/trackFilter';
import type { SourceId, SourceResult, Track } from '../../../shared/types';
import { emptyWaveMemory, pickWaveTracks } from '../../../shared/wave';
import type { SourceStatus } from '../search/sourceQueries';

/** Как жанр называют в запросах: по-русски и по-английски («Хип-хоп» ищут как «рэп» и «hip hop»). */
const GENRE_TERMS: Record<string, { ru: string; en: string }> = {
  electronic: { ru: 'электронная музыка', en: 'electronic' },
  rock: { ru: 'рок', en: 'rock' },
  pop: { ru: 'поп', en: 'pop' },
  jazz: { ru: 'джаз', en: 'jazz' },
  classical: { ru: 'неоклассика', en: 'neoclassical' },
  hiphop: { ru: 'рэп', en: 'hip hop' },
  ambient: { ru: 'эмбиент', en: 'ambient' },
  lounge: { ru: 'лаунж', en: 'lounge' },
  acoustic: { ru: 'акустика', en: 'acoustic' },
  indie: { ru: 'инди', en: 'indie' },
  metal: { ru: 'метал', en: 'metal' },
  folk: { ru: 'фолк', en: 'folk' },
  soundtrack: { ru: 'саундтрек', en: 'soundtrack' },
  blues: { ru: 'блюз', en: 'blues' },
  reggae: { ru: 'регги', en: 'reggae' },
  chillout: { ru: 'чилаут', en: 'chillout' },
};

/** Свежих треков страницы — сидов волны жанра (их YouTube Mix). */
const WAVE_SEED_TRACKS = 10;
/** Песня длится не меньше минуты; верхний предел и слова «интервью/микс/…» — `isLikelyTrack`. */
const MIN_SONG_SEC = 60;
/** Год в названии старше прошлого — старый трек. */
const FRESH_YEARS = 1;

function terms(tag: string): string[] {
  const t = GENRE_TERMS[tag];
  const list = t ? [t.ru, t.en] : [genreName(tag)];
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

/** Поисковые запросы страницы жанра: каждое название со свежим годом. */
export function genreSearchQueries(tag: string, year: number): string[] {
  return terms(tag).map((term) => `${term} ${year}`);
}

/** «Волна: <жанр>»: свежие подборки по жанру, свежие треки страницы — сиды и первые треки. */
export function genreWaveSeed(tag: string, year: number, fresh: readonly Track[]): WaveSeed {
  const [first, ...rest] = terms(tag);
  const queries = [...new Set([`${first} ${year}`, `новый ${first}`, ...rest.map((term) => `${term} ${year}`)])];
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
const NOT_A_SONG = [/ (новинки|хиты) /, / \d+ ?минут /];

function isFreshSong(track: Track, year: number): boolean {
  const d = track.durationSec;
  if (d !== undefined && d < MIN_SONG_SEC) return false;
  if (!isLikelyTrack(track)) return false;
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
  return pickWaveTracks(
    mixed.filter((t) => isFreshSong(t, year)),
    emptyWaveMemory(),
  ).picked;
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
