// Отсев не-треков (интервью, подкасты, миксы, ролики на часы) в поиске YouTube, волне и на страницах жанров.
// Чистая функция без electron и DOM. Звук «Каталога» (`pickYtCandidate`) сюда не относится: там длинный ролик
// проходит по совпадению длительности с треком каталога.
import type { Track } from './types';

/** Дольше этого (8 минут) ролик — трек, только если это официальное аудио (канал «- Topic» и т. п.). */
export const LONG_TRACK_SEC = 480;

/** Версии трека («Radio Mix», «Extended Mix»): слово «mix» после них — не сборник. */
const MIX_VERSION_PREFIX =
  'radio|original|extended|club|dub|vocal|album|single|edit|main|short|clean|dirty|acoustic|instrumental|bonus|dance|vip|remix|ремикс|радио';

/**
 * Слова и обороты нетрековых видео. Проверяются по названию, нормализованному в строку из слов через пробел
 * (границы слов — пробелы: `\b` в JS не видит кириллицу). «Remix» — одно слово и сюда не попадает.
 */
export const NOT_A_TRACK_WORDS: readonly RegExp[] = [
  / (interview|интервью|podcast|подкаст|reaction|реакция|разбор|обзор|review|tutorial|туториал) /,
  / (стрим|stream|livestream|live stream|трансляция|трансляции) /,
  / (documentary|документальный|влог|vlog|behind the scenes) /,
  / (full album|full ep|полный альбом|альбом целиком|full playlist) /,
  / (playlist|плейлист|compilation|сборник|сборка|подборка|nonstop|mixtape|megamix|мегамикс) /,
  new RegExp(` (?<!(?:${MIX_VERSION_PREFIX}) )(?:mix|микс) `),
  / \d+ ?(hour|hours|час|часа|часов) /,
  / все (песни|треки|хиты) /,
  / (лучшие|best) (песни|треки|songs|hits) /,
  / (top|топ) ?\d+ /,
];

function normalize(title: string): string {
  return ` ${title.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

/** Похоже на отдельный трек: нет слов «интервью/микс/…» и не длиннее 8 минут (кроме официального аудио). */
export function isLikelyTrack(t: Pick<Track, 'title' | 'durationSec' | 'official'>): boolean {
  const title = normalize(t.title);
  if (NOT_A_TRACK_WORDS.some((re) => re.test(title))) return false;
  if (t.durationSec !== undefined && t.durationSec > LONG_TRACK_SEC && !t.official) return false;
  return true;
}
