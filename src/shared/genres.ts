// Жанры и сцены: экран «Обзор» (все, группами), ряд жанров главной, пустой поиск, чипы волны и «Что ты слушаешь?»
// (популярные). `tag` — ключ жанра (страница `tag`, вкус `taste.genres`, архив), `name` — подпись в интерфейсе,
// `ru`/`en` — как жанр ищут: первое слово каждого языка — запросы страницы жанра, остальные — сленг сцены для волны.
// Прежние 16 тегов (electronic … chillout) не переименовывать: на них ссылаются сохранённый вкус и жанры чарта.

export type GenreGroup = 'rap' | 'electronic' | 'rock' | 'pop' | 'more';

export interface Genre {
  tag: string;
  name: string;
  group: GenreGroup;
  /** Поисковые слова по-русски (первое — основное). */
  ru: string[];
  /** Поисковые слова по-английски (первое — основное). */
  en: string[];
  /** Показывать среди популярных (`POPULAR_GENRES`). */
  popular?: true;
}

export const GENRE_GROUPS: { id: GenreGroup; name: string }[] = [
  { id: 'rap', name: 'Рэп и хип-хоп' },
  { id: 'electronic', name: 'Электроника' },
  { id: 'rock', name: 'Рок и альтернатива' },
  { id: 'pop', name: 'Поп' },
  { id: 'more', name: 'Ещё' },
];

export const GENRES: Genre[] = [
  // Рэп и хип-хоп
  { tag: 'hiphop', name: 'Хип-хоп', group: 'rap', ru: ['рэп', 'хип-хоп'], en: ['hip hop', 'rap'], popular: true },
  { tag: 'rusrap', name: 'Русский рэп', group: 'rap', ru: ['русский рэп', 'новый русский рэп'], en: ['russian rap'], popular: true },
  { tag: 'trap', name: 'Трэп', group: 'rap', ru: ['трэп', 'трэп рэп'], en: ['trap rap', 'trap'], popular: true },
  { tag: 'drill', name: 'Дрилл', group: 'rap', ru: ['дрилл', 'русский дрилл'], en: ['drill rap', 'uk drill'] },
  { tag: 'cloudrap', name: 'Клауд-рэп', group: 'rap', ru: ['клауд рэп'], en: ['cloud rap'] },
  { tag: 'emorap', name: 'Эмо-рэп', group: 'rap', ru: ['эмо рэп'], en: ['emo rap', 'sad rap'], popular: true },
  { tag: 'plugg', name: 'Плагг', group: 'rap', ru: ['плагг', 'плаг'], en: ['plugg', 'pluggnb'] },
  { tag: 'drain', name: 'Дрейн', group: 'rap', ru: ['дрейн', 'дрейн рэп'], en: ['drain gang', 'drain rap'], popular: true },
  { tag: 'phonk', name: 'Фонк', group: 'rap', ru: ['фонк'], en: ['phonk', 'drift phonk'], popular: true },
  { tag: 'hyperbop', name: 'Хайпербоп', group: 'rap', ru: ['хайпербоп', 'хайпер боп'], en: ['hyperpop rap', 'digicore'] },
  { tag: 'detroit', name: 'Детройт', group: 'rap', ru: ['детройт рэп', 'детройт флоу'], en: ['detroit rap', 'detroit flow'] },

  // Электроника
  { tag: 'electronic', name: 'Электроника', group: 'electronic', ru: ['электронная музыка'], en: ['electronic'], popular: true },
  { tag: 'house', name: 'Хаус', group: 'electronic', ru: ['хаус'], en: ['house music', 'deep house'], popular: true },
  { tag: 'techno', name: 'Техно', group: 'electronic', ru: ['техно'], en: ['techno'] },
  { tag: 'dnb', name: 'Драм-н-бейс', group: 'electronic', ru: ['драм н бейс', 'днб'], en: ['drum and bass', 'dnb'] },
  { tag: 'dubstep', name: 'Дабстеп', group: 'electronic', ru: ['дабстеп'], en: ['dubstep'] },
  { tag: 'witchhouse', name: 'Витч-хаус', group: 'electronic', ru: ['витч хаус'], en: ['witch house'] },
  { tag: 'synthwave', name: 'Синтвейв', group: 'electronic', ru: ['синтвейв'], en: ['synthwave', 'retrowave'] },
  { tag: 'darkwave', name: 'Дарквейв', group: 'electronic', ru: ['дарквейв'], en: ['darkwave', 'coldwave'] },
  { tag: 'jersey', name: 'Джерси', group: 'electronic', ru: ['джерси клаб', 'джерси'], en: ['jersey club'] },
  { tag: 'trance', name: 'Транс', group: 'electronic', ru: ['транс музыка'], en: ['trance music', 'trance'] },
  { tag: 'breakcore', name: 'Брейккор', group: 'electronic', ru: ['брейккор'], en: ['breakcore'] },
  { tag: 'lofi', name: 'Лоу-фай', group: 'electronic', ru: ['лоу фай'], en: ['lofi', 'lo-fi'], popular: true },
  { tag: 'ambient', name: 'Эмбиент', group: 'electronic', ru: ['эмбиент'], en: ['ambient'] },
  { tag: 'chillout', name: 'Чилаут', group: 'electronic', ru: ['чилаут'], en: ['chillout'] },
  { tag: 'lounge', name: 'Лаунж', group: 'electronic', ru: ['лаунж'], en: ['lounge'] },

  // Рок и альтернатива
  { tag: 'rock', name: 'Рок', group: 'rock', ru: ['рок'], en: ['rock'], popular: true },
  { tag: 'indie', name: 'Инди', group: 'rock', ru: ['инди'], en: ['indie'], popular: true },
  { tag: 'alternative', name: 'Альтернатива', group: 'rock', ru: ['альтернатива', 'альтернативный рок'], en: ['alternative rock'] },
  { tag: 'metal', name: 'Метал', group: 'rock', ru: ['метал'], en: ['metal'], popular: true },
  { tag: 'punk', name: 'Панк', group: 'rock', ru: ['панк рок', 'панк'], en: ['punk rock'] },
  { tag: 'postpunk', name: 'Пост-панк', group: 'rock', ru: ['пост панк'], en: ['post punk'] },
  { tag: 'emo', name: 'Эмо', group: 'rock', ru: ['эмо'], en: ['emo', 'midwest emo'] },
  { tag: 'shoegaze', name: 'Шугейз', group: 'rock', ru: ['шугейз'], en: ['shoegaze'] },
  { tag: 'postrock', name: 'Пост-рок', group: 'rock', ru: ['пост рок'], en: ['post rock'] },

  // Поп
  { tag: 'pop', name: 'Поп', group: 'pop', ru: ['поп'], en: ['pop'], popular: true },
  { tag: 'ruspop', name: 'Русский поп', group: 'pop', ru: ['русская поп музыка'], en: ['russian pop'] },
  { tag: 'hyperpop', name: 'Гиперпоп', group: 'pop', ru: ['гиперпоп'], en: ['hyperpop'], popular: true },
  { tag: 'kpop', name: 'К-поп', group: 'pop', ru: ['к поп'], en: ['kpop'] },
  { tag: 'rnb', name: 'R&B', group: 'pop', ru: ['рнб'], en: ['r&b', 'rnb'], popular: true },
  { tag: 'soul', name: 'Соул', group: 'pop', ru: ['соул'], en: ['soul', 'neo soul'] },
  { tag: 'disco', name: 'Диско', group: 'pop', ru: ['диско'], en: ['disco', 'nu disco'] },

  // Ещё
  { tag: 'jazz', name: 'Джаз', group: 'more', ru: ['джаз'], en: ['jazz'], popular: true },
  { tag: 'classical', name: 'Классика', group: 'more', ru: ['неоклассика'], en: ['neoclassical'] },
  { tag: 'acoustic', name: 'Акустика', group: 'more', ru: ['акустика'], en: ['acoustic'] },
  { tag: 'folk', name: 'Фолк', group: 'more', ru: ['фолк'], en: ['folk'] },
  { tag: 'soundtrack', name: 'Саундтрек', group: 'more', ru: ['саундтрек'], en: ['soundtrack'] },
  { tag: 'blues', name: 'Блюз', group: 'more', ru: ['блюз'], en: ['blues'] },
  { tag: 'reggae', name: 'Регги', group: 'more', ru: ['регги'], en: ['reggae'] },
  { tag: 'latin', name: 'Латино', group: 'more', ru: ['латино', 'реггетон'], en: ['reggaeton', 'latin'] },
];

/** Порядок популярных: первые пять — прежние нейтральные жанры (волна без вкуса), дальше — сцены. */
const POPULAR_ORDER = ['pop', 'hiphop', 'electronic', 'rock', 'indie', 'rusrap', 'phonk', 'emorap', 'trap', 'rnb', 'house', 'lofi', 'drain', 'hyperpop', 'metal', 'jazz'];

/** Популярные жанры — главная, пустой поиск, чипы волны, первый запуск. */
export const POPULAR_GENRES: Genre[] = POPULAR_ORDER.map((tag) => GENRES.find((g) => g.tag === tag && g.popular)).filter(
  (g): g is Genre => !!g,
);

export function genreByTag(tag: string): Genre | undefined {
  return GENRES.find((g) => g.tag === tag);
}

export function genreName(tag: string): string {
  return genreByTag(tag)?.name ?? tag;
}
