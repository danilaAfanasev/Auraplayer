import { describe, expect, it } from 'vitest';
import { artistParam, parseArtistParam } from './artistNav';
import { releaseDateLabel, releaseKindLabel, splitReleases } from './releaseFormat';

describe('параметр экрана артиста', () => {
  it('по id и по имени — туда и обратно', () => {
    expect(parseArtistParam(artistParam({ id: '1598190372' }))).toEqual({ id: '1598190372' });
    expect(parseArtistParam(artistParam({ name: 'FORTUNA 812' }))).toEqual({ name: 'FORTUNA 812' });
    expect(parseArtistParam(artistParam({ name: 'id:хитрое имя' }))).toEqual({ name: 'id:хитрое имя' });
  });

  it('имя с подсказкой-треком: туда и обратно; без подсказки параметр прежний', () => {
    const q = { name: 'Zoe', track: { title: 'Ночной звонок' } };
    expect(parseArtistParam(artistParam(q))).toEqual(q);
    expect(artistParam({ name: 'Zoe' })).toBe('name:Zoe');
    // имя и название могут содержать любые знаки, в том числе разделитель
    const odd = { name: 'A|B', track: { title: 'x|track:y' } };
    expect(parseArtistParam(artistParam(odd))).toEqual(odd);
  });

  it('разные треки одного имени — разные ключи страницы (подсказка влияет на выбор тёзки)', () => {
    expect(artistParam({ name: 'Zoe', track: { title: 'A' } })).not.toBe(artistParam({ name: 'Zoe', track: { title: 'B' } }));
    expect(artistParam({ name: 'Zoe', track: { title: '  ' } })).toBe('name:Zoe');
  });

  it('мусор — null', () => {
    expect(parseArtistParam(undefined)).toBeNull();
    expect(parseArtistParam('id:')).toBeNull();
    expect(parseArtistParam('что-то')).toBeNull();
  });
});

describe('подписи релизов', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  it('дата: в этом году — без года, раньше — с годом', () => {
    expect(releaseDateLabel('2026-07-24', now)).toBe('24 июля');
    expect(releaseDateLabel('2025-12-12', now)).toBe('12 декабря 2025');
    expect(releaseDateLabel('мусор', now)).toBe('');
  });
  it('вид релиза по-русски', () => {
    expect([releaseKindLabel('album'), releaseKindLabel('ep'), releaseKindLabel('single')]).toEqual(['Альбом', 'EP', 'Сингл']);
  });
});

describe('разделы релизов на странице артиста', () => {
  const r = (id: string, kind: 'album' | 'ep' | 'single') => ({ id, title: id, artist: 'A', artistId: '1', kind, releaseDate: '2026-01-01', trackCount: 1 });
  it('«Альбомы» — альбомы и EP, «Синглы» — синглы; порядок сохраняется', () => {
    const { albums, singles } = splitReleases([r('1', 'single'), r('2', 'album'), r('3', 'ep'), r('4', 'single')]);
    expect(albums.map((x) => x.id)).toEqual(['2', '3']);
    expect(singles.map((x) => x.id)).toEqual(['1', '4']);
  });
  it('нет синглов — пустой раздел', () => {
    expect(splitReleases([r('2', 'album')]).singles).toEqual([]);
  });
});
