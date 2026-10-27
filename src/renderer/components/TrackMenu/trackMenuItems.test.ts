import { describe, expect, it } from 'vitest';
import type { Track } from '../../../shared/types';
import { albumIdOf, menuPoint, trackMenuItems, type TrackMenuInput } from './trackMenuItems';

const catalogTrack: Track = {
  id: 'catalog:6764095970',
  source: 'catalog',
  sourceId: '6764095970',
  title: 'дорогое',
  artist: 'madk1d & Kai Angel',
  downloadable: true,
  pageUrl: 'https://music.apple.com/ru/album/%D0%B4%D0%BE%D1%80%D0%BE%D0%B3%D0%BE%D0%B5/1895637072?i=6764095970',
};
const ytTrack: Track = { id: 'youtube:abc', source: 'youtube', sourceId: 'abc', title: 'Песня', artist: 'OG Buda', downloadable: true };
const localTrack: Track = { id: 'local:x', source: 'local', sourceId: 'C:/x.mp3', title: 'Файл', artist: 'Кто-то', downloadable: false };

const base = (over: Partial<TrackMenuInput> = {}): TrackMenuInput => ({ track: ytTrack, place: 'table', liked: false, current: false, download: 'none', ...over });
const labels = (input: TrackMenuInput) => trackMenuItems(input).map((e) => e.label);

describe('меню трека', () => {
  it('таблица: все пункты по порядку, «Убрать из очереди» нет', () => {
    expect(labels(base())).toEqual([
      'Мне нравится',
      'Не нравится',
      'Играть следующим',
      'В плейлист…',
      'Скачать',
      'Волна по треку',
      'Перейти к исполнителю',
    ]);
  });

  it('очередь: «Убрать из очереди» — только у будущих; у играющего нет «Играть следующим»', () => {
    expect(labels(base({ place: 'queue', upcoming: true }))).toContain('Убрать из очереди');
    expect(labels(base({ place: 'queue', upcoming: false }))).not.toContain('Убрать из очереди');
    const current = labels(base({ place: 'queue', current: true }));
    expect(current).not.toContain('Играть следующим');
    expect(current).not.toContain('Убрать из очереди');
    expect(labels(base({ place: 'recent', upcoming: true }))).not.toContain('Убрать из очереди');
  });

  it('лайк уже стоит — «Убрать из „Мне нравится“»', () => {
    expect(labels(base({ liked: true }))[0]).toBe('Убрать из «Мне нравится»');
  });

  it('скачивание: идёт — «Отменить скачивание»; скачано, свой файл или запрет — пункта нет', () => {
    expect(labels(base({ download: 'active' }))).toContain('Отменить скачивание');
    expect(labels(base({ download: 'done' })).some((l) => l.includes('качать'))).toBe(false);
    expect(labels(base({ track: localTrack })).some((l) => l.includes('качать'))).toBe(false);
    expect(labels(base({ track: { ...ytTrack, downloadable: false } })).some((l) => l.includes('качать'))).toBe(false);
  });

  it('несколько исполнителей — пункт на каждого; альбом известен — «Перейти к альбому»', () => {
    const items = trackMenuItems(base({ track: catalogTrack }));
    expect(items.filter((e) => e.action.kind === 'artist').map((e) => e.label)).toEqual(['Исполнитель: madk1d', 'Исполнитель: Kai Angel']);
    expect(items.at(-1)).toMatchObject({ label: 'Перейти к альбому', action: { kind: 'album', releaseId: '1895637072' } });
    expect(new Set(items.map((e) => e.key)).size).toBe(items.length);
  });

  it('скрытый трек (приглушённая строка): без «Не нравится», «Играть следующим» и волны', () => {
    const l = labels(base({ blocked: true }));
    expect(l).not.toContain('Не нравится');
    expect(l).not.toContain('Играть следующим');
    expect(l).not.toContain('Волна по треку');
  });

  it('id альбома — только у трека каталога с адресом альбома', () => {
    expect(albumIdOf(catalogTrack)).toBe('1895637072');
    expect(albumIdOf({ source: 'catalog', pageUrl: 'https://music.apple.com/ru/album/x/123?i=4' })).toBe('123');
    expect(albumIdOf({ source: 'youtube', pageUrl: 'https://www.youtube.com/watch?v=abc' })).toBeNull();
    expect(albumIdOf({ source: 'catalog' })).toBeNull();
  });

  it('точка меню: у курсора; с клавиатуры (курсор вне строки или 0,0) — у строки', () => {
    const rect = { left: 100, top: 200, right: 500, bottom: 240 };
    expect(menuPoint({ clientX: 300, clientY: 220 }, rect)).toEqual({ x: 300, y: 220 });
    expect(menuPoint({ clientX: 0, clientY: 0 }, rect)).toEqual({ x: 124, y: 236 });
  });
});
