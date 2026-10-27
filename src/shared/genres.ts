// Жанры для чипов «Жанры» в правой колонке, ряда жанров на главной и экрана «Обзор».
// `tag` — тег, по которому источники ищут подборку (`AuraApi.byTag`), `name` — подпись в интерфейсе.

export interface Genre {
  tag: string;
  name: string;
}

export const GENRES: Genre[] = [
  { tag: 'electronic', name: 'Электроника' },
  { tag: 'rock', name: 'Рок' },
  { tag: 'pop', name: 'Поп' },
  { tag: 'jazz', name: 'Джаз' },
  { tag: 'classical', name: 'Классика' },
  { tag: 'hiphop', name: 'Хип-хоп' },
  { tag: 'ambient', name: 'Эмбиент' },
  { tag: 'lounge', name: 'Лаунж' },
  { tag: 'acoustic', name: 'Акустика' },
  { tag: 'indie', name: 'Инди' },
  { tag: 'metal', name: 'Метал' },
  { tag: 'folk', name: 'Фолк' },
  { tag: 'soundtrack', name: 'Саундтрек' },
  { tag: 'blues', name: 'Блюз' },
  { tag: 'reggae', name: 'Регги' },
  { tag: 'chillout', name: 'Чилаут' },
];

export function genreName(tag: string): string {
  return GENRES.find((g) => g.tag === tag)?.name ?? tag;
}
