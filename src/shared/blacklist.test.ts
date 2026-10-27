import { describe, expect, it } from 'vitest';
import {
  blockArtist,
  blockReason,
  blockTrack,
  emptyBlacklist,
  isArtistBlocked,
  isBlocked,
  isTrackBlocked,
  normalizeBlacklist,
  unblockArtist,
  unblockTrack,
  withoutBlocked,
} from './blacklist';
import type { Track } from './types';

const t = (id: string, artist: string, title: string, source: Track['source'] = 'youtube'): Track => ({
  id: `${source}:${id}`,
  source,
  sourceId: id,
  title,
  artist,
  downloadable: true,
});

describe('чёрный список: треки', () => {
  it('скрытый трек ловится по id и как та же песня из другого источника', () => {
    const fromCatalog = t('123', 'madk1d', 'Цена', 'catalog');
    const bl = blockTrack(emptyBlacklist(), fromCatalog, 1000);
    expect(bl.tracks).toHaveLength(1);
    expect(bl.tracks[0]).toMatchObject({ track: fromCatalog, blockedAt: 1000 });
    expect(isTrackBlocked(fromCatalog, bl)).toBe(true);
    expect(isTrackBlocked(t('abc', 'MADK1D', 'цена (Official Audio)'), bl)).toBe(true);
    expect(isBlocked(t('sc1', 'madk1d', 'Цена', 'soundcloud'), bl)).toBe(true);
    expect(isBlocked(t('xyz', 'madk1d', 'Засосы'), bl)).toBe(false);
    expect(blockReason(fromCatalog, bl)).toBe('track');
  });

  it('повторное скрытие не дублирует; «Вернуть» снимает', () => {
    const a = t('a', 'A', 'Song');
    const bl = blockTrack(blockTrack(emptyBlacklist(), a, 1), a, 2);
    expect(bl.tracks).toHaveLength(1);
    const back = unblockTrack(bl, a.id);
    expect(back.tracks).toEqual([]);
    expect(isBlocked(a, back)).toBe(false);
  });

  it('треки без исполнителя (свои файлы) не совпадают друг с другом по названию', () => {
    const a = t('C:\\a.mp3', '', 'Track 01', 'local');
    const bl = blockTrack(emptyBlacklist(), a, 1);
    expect(isBlocked(a, bl)).toBe(true);
    expect(isBlocked(t('C:\\b.mp3', '', 'Track 01', 'local'), bl)).toBe(false);
  });
});

describe('чёрный список: исполнители', () => {
  it('ловится трек любого исполнителя из списка — основного, соисполнителя, фита в поле и в названии', () => {
    const bl = blockArtist(emptyBlacklist(), { name: 'Bad', id: '42' }, 5);
    expect(bl.artists).toEqual([{ key: 'bad', name: 'Bad', id: '42', blockedAt: 5 }]);
    expect(isArtistBlocked('BAD', bl)).toBe(true);
    expect(blockReason(t('1', 'Bad', 'Своя'), bl)).toBe('artist');
    expect(isBlocked(t('2', 'Good & Bad', 'Вместе'), bl)).toBe(true);
    expect(isBlocked(t('3', 'Good feat. Bad', 'Вместе'), bl)).toBe(true);
    expect(isBlocked(t('4', 'Other', 'Song (feat. Bad)'), bl)).toBe(true);
    expect(isBlocked(t('5', 'Other', 'Badminton'), bl)).toBe(false);
    expect(blockReason(t('5', 'Other', 'Badminton'), bl)).toBeNull();
  });

  it('дуэт, скрытый целиком, скрывает свои треки', () => {
    const bl = blockArtist(emptyBlacklist(), { name: 'HammAli & Navai' }, 1);
    expect(isBlocked(t('h1', 'HammAli & Navai', 'Птичка'), bl)).toBe(true);
    expect(blockReason(t('h2', 'HammAli & Navai', 'Девочка, танцуй (feat. X)'), bl)).toBe('artist');
  });

  it('«Вернуть» исполнителя — по ключу', () => {
    const bl = blockArtist(blockArtist(emptyBlacklist(), { name: 'Bad' }, 1), { name: 'bad' }, 2);
    expect(bl.artists).toHaveLength(1);
    expect(unblockArtist(bl, 'bad').artists).toEqual([]);
  });
});

describe('withoutBlocked', () => {
  it('убирает скрытые, порядок остальных сохраняется', () => {
    const items = [t('1', 'A', 'a'), t('2', 'Bad', 'b'), t('3', 'C', 'c'), t('4', 'D', 'd')].map((track, i) => ({ track, n: i }));
    let bl = blockArtist(emptyBlacklist(), { name: 'Bad' }, 1);
    bl = blockTrack(bl, items[3].track, 1);
    expect(withoutBlocked(items, bl, (x) => x.track).map((x) => x.n)).toEqual([0, 2]);
  });
});

describe('normalizeBlacklist', () => {
  it('мусор — пустой список; битые записи отбрасываются, ключи восстанавливаются', () => {
    expect(normalizeBlacklist(undefined)).toEqual(emptyBlacklist());
    expect(normalizeBlacklist('x')).toEqual(emptyBlacklist());
    const good = t('a', 'A', 'Song');
    const bl = normalizeBlacklist({
      tracks: [{ track: good, blockedAt: 3 }, { track: { id: 1 } }, { track: good, songKey: 'x', blockedAt: 4 }, 'junk'],
      artists: [{ name: 'Bad', blockedAt: 2, imageUrl: 'https://img/1.jpg' }, { name: '' }, { name: 'bad' }, null],
    });
    expect(bl.tracks).toHaveLength(1);
    expect(bl.tracks[0].blockedAt).toBe(3);
    expect(isBlocked(t('other', 'a', 'song (live)'), bl)).toBe(true);
    expect(bl.artists).toEqual([{ key: 'bad', name: 'Bad', imageUrl: 'https://img/1.jpg', blockedAt: 2 }]);
  });
});
