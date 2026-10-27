import { describe, expect, it } from 'vitest';
import { cleanRelease } from './release';

const valid = {
  id: '6820766679',
  title: 'Omertà 2',
  artist: 'Captown & Niman',
  artistId: '1436282869',
  kind: 'album',
  releaseDate: '2026-10-23',
  trackCount: 10,
  coverUrl: 'https://is1.example/600x600bb.jpg',
  similarTo: { id: '55', name: 'Truwer' },
};

describe('cleanRelease: снимок релиза из файла', () => {
  it('целый релиз проходит как есть', () => {
    expect(cleanRelease(valid)).toEqual(valid);
  });

  it('лишние поля отбрасываются, обложка не по https — тоже', () => {
    const r = cleanRelease({ ...valid, extra: 1, coverUrl: 'http://x/y.jpg' });
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('extra');
    expect(r).not.toHaveProperty('coverUrl');
  });

  it('число треков меньше нуля или не число — 0', () => {
    expect(cleanRelease({ ...valid, trackCount: -3 })?.trackCount).toBe(0);
    expect(cleanRelease({ ...valid, trackCount: 'много' })?.trackCount).toBe(0);
  });

  it.each([
    ['id не из цифр', { id: 'abc' }],
    ['пустое название', { title: '  ' }],
    ['нет исполнителя', { artist: undefined }],
    ['artistId не из цифр', { artistId: 'x1' }],
    ['неизвестный вид', { kind: 'live' }],
    ['дата не YYYY-MM-DD', { releaseDate: '2026' }],
  ])('битый релиз — null: %s', (_why, patch) => {
    expect(cleanRelease({ ...valid, ...patch })).toBeNull();
  });

  it('не объект — null', () => {
    expect(cleanRelease(null)).toBeNull();
    expect(cleanRelease('релиз')).toBeNull();
    expect(cleanRelease([valid])).toBeNull();
  });
});
