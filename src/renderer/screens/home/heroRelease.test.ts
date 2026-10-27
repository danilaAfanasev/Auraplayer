import { describe, expect, it } from 'vitest';
import type { ArtistRelease, Track } from '../../../shared/types';
import { chartHero, countryGenitive, releaseHero } from './heroRelease';

const track = (id: string): Track => ({
  id: `catalog:${id}`,
  source: 'catalog',
  sourceId: id,
  title: `Трек ${id}`,
  artist: `Исполнитель ${id}`,
  album: `Альбом ${id}`,
  coverUrl: `https://img.example/${id}.jpg`,
  downloadable: true,
});

describe('chartHero', () => {
  it('баннер — первый трек «Популярного сейчас»: №1 в чарте, «Слушать» — весь чарт с первого трека', () => {
    const chart = [track('1'), track('2'), track('3')];
    expect(chartHero(chart, 'ru')).toEqual({
      title: 'Трек 1',
      artist: 'Исполнитель 1',
      album: 'Альбом 1',
      coverUrl: 'https://img.example/1.jpg',
      eyebrow: 'Популярное сейчас',
      stat: { label: 'В чарте России', value: '№1', kind: 'chart' },
      tracks: [chart[0]],
      queue: chart,
      start: 0,
    });
  });

  it('плашка говорит о выбранной стране чарта, а не всегда о России', () => {
    expect(chartHero([track('1')], 'us')?.stat.label).toBe('В чарте США');
    expect(chartHero([track('1')], 'de')?.stat.label).toBe('В чарте Германии');
    expect(chartHero([track('1')], 'by')?.stat.label).toBe('В чарте Беларуси');
    expect(countryGenitive(undefined)).toBeUndefined();
    expect(chartHero([track('1')])?.stat.label).toBe('В чарте');
    expect(countryGenitive('gb')).toBe('Великобритании');
  });

  it('пустой чарт — баннера нет', () => {
    expect(chartHero([])).toBeNull();
  });
});

describe('releaseHero', () => {
  const release: ArtistRelease = {
    id: '42',
    title: 'EUPHORIA',
    artist: 'SALUKI',
    artistId: '1427819350',
    kind: 'album',
    releaseDate: '2026-07-24',
    trackCount: 20,
    coverUrl: 'https://img.example/e.jpg',
  };
  const now = Date.parse('2026-10-25T12:00:00Z');

  it('свежий релиз подписки: подпись ленты и вид, дата выхода на плашке; «Слушать» — треки релиза', () => {
    const tracks = [track('a'), track('b')];
    expect(releaseHero(release, tracks, now)).toEqual({
      title: 'EUPHORIA',
      artist: 'SALUKI',
      coverUrl: 'https://img.example/e.jpg',
      eyebrow: 'Новое от моих артистов · Альбом',
      stat: { label: 'Дата выхода', value: '24 июля', kind: 'release' },
      tracks,
      queue: tracks,
      start: 0,
      release,
    });
  });

  it('треки ещё не загружены — очередь пустая, релиз при баннере (треки подгрузятся по «Слушать»)', () => {
    const hero = releaseHero(release, null, now);
    expect(hero.queue).toEqual([]);
    expect(hero.release).toBe(release);
  });
});
