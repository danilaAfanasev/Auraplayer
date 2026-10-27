import { describe, expect, it } from 'vitest';
import { blockArtist, emptyLibrary, toggleAlbumLike, unblockArtist } from '../../../shared/library';
import type { ArtistRelease } from '../../../shared/types';
import { albumsCountLabel, visibleAlbums } from './albumsView';

const album = (id: string, artist: string, patch: Partial<ArtistRelease> = {}): ArtistRelease => ({
  id,
  title: `Альбом ${id}`,
  artist,
  artistId: '1',
  kind: 'album',
  releaseDate: '2026-10-23',
  trackCount: 9,
  ...patch,
});

describe('раздел «Альбомы»: что показать', () => {
  it('новые сохранённые первыми, независимо от порядка в файле', () => {
    let lib = toggleAlbumLike(emptyLibrary(), album('1', 'A'), 100);
    lib = toggleAlbumLike(lib, album('2', 'B'), 300);
    lib = toggleAlbumLike(lib, album('3', 'C'), 200);
    expect(visibleAlbums(lib.likedAlbums, lib.blacklist).map((r) => r.id)).toEqual(['2', '3', '1']);
    const shuffled = [...lib.likedAlbums].reverse();
    expect(visibleAlbums(shuffled, lib.blacklist).map((r) => r.id)).toEqual(['2', '3', '1']);
  });

  it('альбомы скрытого исполнителя не видны (и на фите), в файле остаются; «Вернуть» их возвращает', () => {
    let lib = toggleAlbumLike(emptyLibrary(), album('1', 'Good'), 1);
    lib = toggleAlbumLike(lib, album('2', 'Bad'), 2);
    lib = toggleAlbumLike(lib, album('3', 'Good & Bad'), 3);
    lib = blockArtist(lib, { name: 'Bad' }, 10);
    expect(visibleAlbums(lib.likedAlbums, lib.blacklist).map((r) => r.id)).toEqual(['1']);
    expect(lib.likedAlbums).toHaveLength(3);
    lib = unblockArtist(lib, 'bad');
    expect(visibleAlbums(lib.likedAlbums, lib.blacklist).map((r) => r.id)).toEqual(['3', '2', '1']);
  });

  it('счётчик в шапке по-русски', () => {
    expect([1, 2, 5, 12, 21].map(albumsCountLabel)).toEqual(['1 альбом', '2 альбома', '5 альбомов', '12 альбомов', '21 альбом']);
  });
});
