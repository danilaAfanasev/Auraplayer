import { describe, expect, it } from 'vitest';
import { artistKey, splitArtists } from './artistNames';

describe('splitArtists', () => {
  it('фит в названии — тоже исполнитель трека', () => {
    expect(splitArtists('Other', 'Song (feat. Bad)')).toEqual(['Other', 'Bad']);
    expect(splitArtists('Other', 'Song [ft. Bad & Worse]')).toEqual(['Other', 'Bad', 'Worse']);
    expect(splitArtists('madk1d', 'цена ft. VILLIAN')).toEqual(['madk1d', 'VILLIAN']);
    expect(splitArtists('Скриптонит', 'Притон (при уч. Andy Panda)')).toEqual(['Скриптонит', 'Andy Panda']);
    expect(splitArtists('A', 'Track (with B)')).toEqual(['A', 'B']);
  });

  it('«A & B feat. C» — три имени, основной первым', () => {
    expect(splitArtists('A & B feat. C')).toEqual(['A', 'B', 'C']);
    expect(splitArtists('OG Buda x MAYOT, Платина')).toEqual(['OG Buda', 'MAYOT', 'Платина']);
    expect(splitArtists('Aarne with Toxi$')).toEqual(['Aarne', 'Toxi$']);
    expect(splitArtists('A при уч. B')).toEqual(['A', 'B']);
    expect(splitArtists('A &amp; B')).toEqual(['A', 'B']);
  });

  it('имена с запятой, & или / внутри не режутся', () => {
    expect(splitArtists('Tyler, The Creator')).toEqual(['Tyler, The Creator']);
    expect(splitArtists('Tyler, The Creator & Kali Uchis')).toEqual(['Tyler, The Creator', 'Kali Uchis']);
    expect(splitArtists('AC/DC')).toEqual(['AC/DC']);
    // «x» внутри имени — не разделитель
    expect(splitArtists('xxxmanera')).toEqual(['xxxmanera']);
  });

  it('без дублей; «[prod. X]» — не исполнитель; пометки в названии без фита не трогаются', () => {
    expect(splitArtists('A feat. B', 'Song (feat. B)')).toEqual(['A', 'B']);
    expect(splitArtists('A', 'Song [prod. Producer]')).toEqual(['A']);
    expect(splitArtists('A', 'Defeat (Official Audio)')).toEqual(['A']);
    expect(splitArtists('A', 'Dance with Me')).toEqual(['A']);
    expect(splitArtists('')).toEqual([]);
  });
});

describe('artistKey', () => {
  it('регистр, ё и знаки не важны', () => {
    expect(artistKey('Toxi$')).toBe('toxi');
    expect(artistKey('Ёлка')).toBe('елка');
    expect(artistKey('  OG  Buda ')).toBe('og buda');
    expect(artistKey('Tyler, The Creator')).toBe('tyler the creator');
  });
});
