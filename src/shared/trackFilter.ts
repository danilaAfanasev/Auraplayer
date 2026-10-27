// Отсев не-треков (интервью, подкасты, миксы, ролики на часы) в поиске YouTube, волне и на страницах жанров.
// Чистая функция без electron и DOM. Звук «Каталога» (`pickYtCandidate`) сюда не относится: там длинный ролик
// проходит по совпадению длительности с треком каталога.
import type { Track } from './types';

/** Дольше этого (8 минут) ролик — трек, только если это официальное аудио (канал «- Topic» и т. п.). */
export const LONG_TRACK_SEC = 480;
/**
 * Короче этого — обрывок, тизер или шортс, а не песня: обрывки 6–25 с отсекаются, а интро и скиты альбомов (0:40)
 * остаются. Волна и жанры держат свою границу — минуту.
 */
export const MIN_TRACK_SEC = 30;

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
  // Только явные формы: «OG BUDA ОТВЕЧАЕТ НА 20 ВОПРОСОВ», «Q&A», «вопрос-ответ». «Без вопросов», «99 вопросов»,
  // «Она не отвечает на звонки», «Остаться за кадром», «Backstage Pass» — песни.
  / (отвечает|отвечают|ответил|ответила|ответили) на (\d+ )?(вопрос|вопроса|вопросов|вопросы) /,
  / \d+ (глупых|неудобных|быстрых|каверзных|странных) (вопрос|вопроса|вопросов) /,
  / (вопрос ответ|q a|q and a) /,
  / (backstage|бэкстейдж) (video|видео|footage|vlog|влог) /,
  / (shorts|шортс|short video) /,
  / (full album|full ep|полный альбом|альбом целиком|full playlist) /,
  / (playlist|плейлист|compilation|сборник|сборка|подборка|nonstop|mixtape|megamix|мегамикс) /,
  new RegExp(` (?<!(?:${MIX_VERSION_PREFIX}) )(?:mix|микс) `),
  / все (песни|треки|хиты) /,
  / (лучшие|best) (песни|треки|songs|hits) /,
  / (top|топ) ?\d+ /,
];

/**
 * Тизеры, трейлеры, превью, сниппеты, бэкстейдж — только явные формы: «Official Trailer», «Album Preview», «(Snippet)»,
 * «Тизер нового альбома». Одиночное слово — бывает песней («Trailer Park», «Teaser»). Официальное аудио (канал «- Topic»)
 * этими словами не режется.
 */
const TEASER = 'trailer|teaser|preview|snippet|тизер|трейлер|превью|сниппет';
const TEASER_FORMS: readonly RegExp[] = [
  new RegExp(` (official|album|ep|tour|music video|video|clip|альбома|клипа|официальный) (${TEASER}) `),
  new RegExp(` (${TEASER}) (альбома|клипа|трека|песни|нового|новой) `),
];
/** То же в скобках целиком: «(Teaser)», «[Official Trailer]», «(Backstage)». */
const TEASER_IN_BRACKETS = new RegExp(`[([]\\s*(?:official\\s+|album\\s+|new\\s+)?(?:${TEASER}|backstage|бэкстейдж)\\s*[)\\]]`, 'i');

function isTeaser(rawTitle: string, title: string): boolean {
  return TEASER_IN_BRACKETS.test(rawTitle) || TEASER_FORMS.some((re) => re.test(title));
}

/**
 * «1 час», «10 hours»: ролик на час, только если он и правда длинный или слово вплотную за часами говорит об этом
 * («10 hours of», «1 hour mix», «1 hour loop»), либо «часовая версия». «24 Hours (Official Music Video)»,
 * «24 Hours (Radio Mix)», «24 часа» на три минуты — песни.
 */
const HOURS = / \d+ ?(hour|hours|hr|hrs|час|часа|часов) /;
const HOURS_THEN_LONG =
  / \d+ ?(hour|hours|hr|hrs|час|часа|часов) (of|loop|looped|mix|микс|version|версия|edition|nonstop|non stop|без перерыва|music|музыки|sleep|relax|study|ambient|beats|long) /;

function isHoursVideo(title: string, durationSec: number | undefined): boolean {
  if (!HOURS.test(title)) return false;
  if (durationSec !== undefined && durationSec > LONG_TRACK_SEC) return true;
  return HOURS_THEN_LONG.test(title) || / (часовая|часовой) /.test(title);
}

function normalize(title: string): string {
  return ` ${title.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

/** Похоже на отдельный трек: нет слов «интервью/микс/…», не короче 30 с и не длиннее 8 минут (кроме официального аудио). */
export function isLikelyTrack(t: Pick<Track, 'title' | 'durationSec' | 'official'>): boolean {
  const title = normalize(t.title);
  if (NOT_A_TRACK_WORDS.some((re) => re.test(title))) return false;
  if (!t.official && isTeaser(t.title, title)) return false;
  if (isHoursVideo(title, t.durationSec)) return false;
  if (t.durationSec !== undefined && t.durationSec > 0 && t.durationSec < MIN_TRACK_SEC) return false;
  if (t.durationSec !== undefined && t.durationSec > LONG_TRACK_SEC && !t.official) return false;
  return true;
}
