import { describe, expect, it } from 'vitest';
import { artistLinkParts } from './artistLinkParts';

const names = (artist: string, title?: string) => artistLinkParts(artist, title).map((p) => p.name ?? null);
const text = (artist: string, title?: string) => artistLinkParts(artist, title).map((p) => p.text).join('');

describe('artistLinkParts — имена исполнителей, каждое отдельной ссылкой', () => {
  it('один исполнитель — одна ссылка', () => {
    expect(artistLinkParts('Tate McRae')).toEqual([{ text: 'Tate McRae', name: 'Tate McRae' }]);
  });

  it('«A & B», «A, B», «A feat. B», «A x B» — каждое имя отдельно, разделители остаются текстом', () => {
    expect(artistLinkParts('VILLIAN & madk1d')).toEqual([
      { text: 'VILLIAN', name: 'VILLIAN' },
      { text: ' & ' },
      { text: 'madk1d', name: 'madk1d' },
    ]);
    expect(artistLinkParts('Баста, Гуф')).toEqual([{ text: 'Баста', name: 'Баста' }, { text: ', ' }, { text: 'Гуф', name: 'Гуф' }]);
    expect(names('Future feat. Drake, Gunna')).toEqual(['Future', null, 'Drake', null, 'Gunna']);
    expect(text('Future feat. Drake')).toBe('Future feat. Drake');
    expect(names('Still Brickin x Mazza L20').filter(Boolean)).toEqual(['Still Brickin', 'Mazza L20']);
  });

  it('«A & B feat. C» — три ссылки, текст как был', () => {
    expect(names('A & B feat. C')).toEqual(['A', null, 'B', null, 'C']);
    expect(text('A & B feat. C')).toBe('A & B feat. C');
  });

  it('фит из названия «Song (feat. C)» — отдельной ссылкой после исполнителя', () => {
    expect(artistLinkParts('A', 'Song (feat. C)')).toEqual([{ text: 'A', name: 'A' }, { text: ' feat. ' }, { text: 'C', name: 'C' }]);
    expect(names('A', 'Song (feat. C & D)')).toEqual(['A', null, 'C', null, 'D']);
    // Фит уже есть в строке исполнителя — второй раз не добавляется.
    expect(names('A feat. C', 'Song (feat. C)')).toEqual(['A', null, 'C']);
  });

  it('фит в скобках в строке исполнителя, имена с разделителем внутри, &amp;', () => {
    expect(artistLinkParts('A (feat. B)')).toEqual([{ text: 'A', name: 'A' }, { text: ' (feat. ' }, { text: 'B', name: 'B' }, { text: ')' }]);
    expect(names('Tyler, The Creator & Kali Uchis')).toEqual(['Tyler, The Creator', null, 'Kali Uchis']);
    expect(text('Simon &amp; Garfunkel')).toBe('Simon & Garfunkel');
    expect(names('Simon &amp; Garfunkel')).toEqual(['Simon & Garfunkel']);
  });

  it('имя внутри другого имени не путается: «Max & Ax»', () => {
    expect(artistLinkParts('Max & Ax')).toEqual([{ text: 'Max', name: 'Max' }, { text: ' & ' }, { text: 'Ax', name: 'Ax' }]);
  });

  it('пусто — пусто', () => {
    expect(artistLinkParts('')).toEqual([]);
    expect(artistLinkParts('   ')).toEqual([]);
  });
});
