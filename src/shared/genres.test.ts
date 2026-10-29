import { describe, expect, it } from 'vitest';
import { GENRE_GROUPS, GENRES, POPULAR_GENRES, genreByTag, genreName } from './genres';

/** Теги первого списка: на них ссылаются вкус (`taste.genres`), архив и жанры чарта — должны остаться. */
const OLD_TAGS = [
  'electronic',
  'rock',
  'pop',
  'jazz',
  'classical',
  'hiphop',
  'ambient',
  'lounge',
  'acoustic',
  'indie',
  'metal',
  'folk',
  'soundtrack',
  'blues',
  'reggae',
  'chillout',
];

/** Жанры и сцены из истории 178 — по подписи. */
const FROM_STORY = [
  'Эмо-рэп',
  'Дрейн',
  'Фонк',
  'Трэп',
  'Клауд-рэп',
  'Дрилл',
  'Плагг',
  'Хайпербоп',
  'Русский рэп',
  'Хаус',
  'Техно',
  'Драм-н-бейс',
  'Дабстеп',
  'Витч-хаус',
  'Синтвейв',
  'Дарквейв',
  'Джерси',
  'Детройт',
  'Лоу-фай',
  'Эмо',
  'Пост-панк',
  'Шугейз',
  'Панк',
  'Альтернатива',
  'Гиперпоп',
  'К-поп',
  'R&B',
  'Соул',
];

describe('GENRES', () => {
  it('около 45–50 жанров, у каждого свой тег, группа из списка групп и поисковые слова на двух языках', () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(45);
    expect(GENRES.length).toBeLessThanOrEqual(50);
    expect(new Set(GENRES.map((g) => g.tag)).size).toBe(GENRES.length);
    const groups = GENRE_GROUPS.map((g) => g.id);
    for (const g of GENRES) {
      expect(groups).toContain(g.group);
      expect(g.ru.length).toBeGreaterThan(0);
      expect(g.en.length).toBeGreaterThan(0);
      expect(g.en.every((w) => /^[\x20-\x7e]+$/.test(w))).toBe(true);
    }
  });

  it('группы — «Рэп и хип-хоп», «Электроника», «Рок и альтернатива», «Поп», «Ещё», в каждой есть жанры', () => {
    expect(GENRE_GROUPS.map((g) => g.name)).toEqual(['Рэп и хип-хоп', 'Электроника', 'Рок и альтернатива', 'Поп', 'Ещё']);
    for (const group of GENRE_GROUPS) expect(GENRES.some((g) => g.group === group.id)).toBe(true);
  });

  it('прежние 16 тегов остаются', () => {
    for (const tag of OLD_TAGS) expect(genreByTag(tag)).toBeDefined();
    expect(genreName('hiphop')).toBe('Хип-хоп');
  });

  it('есть жанры и сцены, о которых просил пользователь', () => {
    const names = GENRES.map((g) => g.name);
    for (const name of FROM_STORY) expect(names).toContain(name);
  });

  it('неизвестный тег — подпись сам тег, жанра нет', () => {
    expect(genreName('witch house')).toBe('witch house');
    expect(genreByTag('nope')).toBeUndefined();
  });
});

describe('POPULAR_GENRES', () => {
  it('часть общего списка — не все 50; первыми — прежние нейтральные, есть новые (эмо-рэп, фонк)', () => {
    expect(POPULAR_GENRES.length).toBeLessThan(GENRES.length);
    expect(POPULAR_GENRES.length).toBeGreaterThanOrEqual(10);
    for (const g of POPULAR_GENRES) expect(GENRES).toContain(g);
    const tags = POPULAR_GENRES.map((g) => g.tag);
    expect(tags.slice(0, 5)).toEqual(['pop', 'hiphop', 'electronic', 'rock', 'indie']);
    expect(POPULAR_GENRES.map((g) => g.name)).toEqual(expect.arrayContaining(['Эмо-рэп', 'Фонк']));
  });
});
