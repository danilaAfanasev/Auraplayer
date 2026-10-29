import { describe, expect, it } from 'vitest';
import type { SourceResult, Track } from '../../../shared/types';
import type { SourceStatus } from '../search/sourceQueries';
import { freshGenreTracks, genrePlaylistQueries, genreSearchQueries, genreWaveSeed, mergeGenreStatuses } from './genreQueries';

const yt = (id: string, title: string, artist: string, durationSec?: number): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title,
  artist,
  downloadable: true,
  ...(durationSec ? { durationSec } : {}),
});
const done = (tracks: Track[], error?: SourceResult['error']): SourceStatus => ({
  status: 'done',
  result: { source: 'youtube', tracks, ...(error ? { error } : {}) },
});

describe('genreSearchQueries', () => {
  it('«Хип-хоп» ищется по-русски и по-английски со свежим годом', () => {
    expect(genreSearchQueries('hiphop', 2026)).toEqual(['рэп 2026', 'hip hop 2026']);
  });
  it('новые жанры — свои слова сцены: дрейн ищется как «дрейн» и «drain gang»', () => {
    expect(genreSearchQueries('drain', 2026)).toEqual(['дрейн 2026', 'drain gang 2026']);
    expect(genreSearchQueries('emorap', 2026)).toEqual(['эмо рэп 2026', 'emo rap 2026']);
  });
  it('неизвестный тег — по его названию с годом', () => {
    expect(genreSearchQueries('witch house', 2026)).toEqual(['witch house 2026']);
  });
});

describe('genrePlaylistQueries', () => {
  it('подборки жанра в каталоге — по названиям сцены без года: у редких жанров «<жанр> 2026» почти одни миксы', () => {
    expect(genrePlaylistQueries('witchhouse')).toEqual(['witch house', 'витч хаус']);
    expect(genrePlaylistQueries('phonk')).toEqual(['phonk', 'drift phonk', 'фонк']);
    expect(genrePlaylistQueries('witch house')).toEqual(['witch house']);
  });
});

describe('genreWaveSeed', () => {
  it('волна жанра: название жанра, свежие запросы, свежие треки страницы — сиды', () => {
    const fresh = [yt('aaaaaaaaaaa', 'Трек', 'madk1d', 150)];
    const seed = genreWaveSeed('hiphop', 2026, fresh);
    expect(seed.title).toBe('Хип-хоп');
    expect(seed.queries).toEqual(expect.arrayContaining(['рэп 2026', 'новый рэп', 'hip hop 2026']));
    expect(seed.tracks).toEqual(fresh);
    expect(seed.extra).toEqual(fresh);
    expect(seed.lead).toBeUndefined();
  });
  it('волна жанра ищет и по-английски, и сленгом сцены — без года тоже', () => {
    const queries = genreWaveSeed('drain', 2026, []).queries ?? [];
    expect(queries).toEqual(expect.arrayContaining(['дрейн 2026', 'новый дрейн', 'drain gang 2026', 'drain gang', 'drain rap']));
  });
  it('без свежих треков — только запросы', () => {
    const seed = genreWaveSeed('hiphop', 2026, []);
    expect(seed.tracks).toBeUndefined();
    expect(seed.extra).toBeUndefined();
  });
});

describe('freshGenreTracks', () => {
  it('без сборников, длинных миксов и треков со старым годом в названии; без дублей; запросы вперемешку', () => {
    const ru = [
      yt('ru000000001', 'Новый трек', 'madk1d', 160),
      yt('ru000000002', 'РЭП 2026 — сборник лучших треков', 'Канал', 3600),
      yt('ru000000003', 'Хит (2019)', 'Старый', 200),
      yt('ru000000004', 'Песня', 'VILLIAN', 170),
    ];
    const en = [
      yt('en000000001', 'Song', '21 Savage', 180),
      yt('en000000002', 'Новый трек (Official Audio)', 'madk1d', 161), // та же песня с другого видео
      yt('en000000003', 'Hip Hop Mix 2026', 'DJ', 300),
      yt('en000000004', 'Track 2025', 'Gunna', 190),
    ];
    expect(freshGenreTracks([ru, en], 2026).map((t) => t.id)).toEqual([
      'youtube:ru000000001',
      'youtube:en000000001',
      'youtube:ru000000004',
      'youtube:en000000004',
    ]);
  });
});

describe('freshGenreTracks — отсев не-треков', () => {
  it('интервью отсеяно при любой длительности, длинный Topic-трек проходит, ролик на полчаса — нет', () => {
    const topic = { ...yt('tp000000001', 'Длинный трек', 'Kai Angel', 1500), official: true as const };
    const list = [
      yt('iv000000001', 'Артист — интервью про новый альбом', 'Канал', 240),
      yt('lg000000001', 'Длинный ролик', 'Канал', 1500),
      topic,
      yt('rm000000001', 'Песня (Remix)', 'DJ', 180),
    ];
    expect(freshGenreTracks([list], 2026).map((t) => t.id)).toEqual(['youtube:tp000000001', 'youtube:rm000000001']);
  });
});

describe('freshGenreTracks — сцена из нескольких исполнителей', () => {
  it('у редкого жанра несколько треков одного исполнителя подряд — все остаются на странице (окно 10 — только у волны)', () => {
    const list = [yt('bl000000001', 'Obedient', 'Bladee', 200), yt('bl000000002', 'Be Nice 2 Me', 'Bladee', 180), yt('bl000000003', 'Rain', 'Bladee', 190)];
    expect(freshGenreTracks([list], 2026)).toHaveLength(3);
  });
});

describe('freshGenreTracks — ролики о жанре', () => {
  it('видеоэссе и уроки о сцене (живая выдача «эмо рэп», «шугейз», «плагг») — не треки; песня «Почему» — трек', () => {
    const list = [
      yt('es000000001', 'Why Emo Rap Died Off...', 'Aimz', 420),
      yt('es000000002', 'The History of Hyperpop in 7 Minutes', 'Lightcore Beats', 420),
      yt('es000000003', 'every niche music genre explained', 'tundra', 382),
      yt('es000000004', 'How To Make 2026 Dark Plugg Placement Loops | FL 25', '6shootaa', 360),
      yt('es000000005', 'Dear Drain Gang and Haunted Mound Fans.. (ANNOUNCEMENT)', 'kne', 420),
      yt('es000000006', 'This Trend Is RUINING Shoegaze...', 'iconix', 420),
      yt('so000000001', 'Почему', 'Любимый', 190),
    ];
    expect(freshGenreTracks([list], 2026).map((t) => t.id)).toEqual(['youtube:so000000001']);
  });
});

describe('freshGenreTracks — длинные треки жанра', () => {
  const sc = (id: string, title: string, artist: string, durationSec: number): Track => ({
    id: `soundcloud:${id}`,
    source: 'soundcloud',
    sourceId: id,
    title,
    artist,
    downloadable: true,
    durationSec,
  });
  it('настоящие длинные треки (дрейн, пост-рок по 9–12 минут) проходят, часовые сборники и миксы — нет', () => {
    const list = [
      sc('1', 'Obedient', 'Bladee', 560),
      sc('2', 'Sunset Over The Pier', 'Post Rock Band', 715),
      sc('3', 'DRAIN GANG MIX 1 HOUR', 'Канал', 3600),
      sc('4', 'Дрейн сборник 2026', 'Канал', 2400),
      sc('5', 'Sad Song', 'Somebody', 2400),
    ];
    expect(freshGenreTracks([list], 2026).map((t) => t.id)).toEqual(['soundcloud:1', 'soundcloud:2']);
  });
});

describe('mergeGenreStatuses', () => {
  it('все запросы грузятся — загрузка; один ответил — его треки', () => {
    expect(mergeGenreStatuses('youtube', [{ status: 'loading' }, undefined], 2026)).toEqual({ status: 'loading' });
    const merged = mergeGenreStatuses('youtube', [{ status: 'loading' }, done([yt('aaaaaaaaaaa', 'Трек', 'A', 150)])], 2026);
    expect(merged?.status === 'done' && merged.result.tracks.map((t) => t.id)).toEqual(['youtube:aaaaaaaaaaa']);
  });
  it('все ответили ошибкой — ошибка первого', () => {
    const err = { kind: 'disabled' as const, message: 'YouTube выключен' };
    const merged = mergeGenreStatuses('youtube', [done([], err), done([], { kind: 'offline', message: 'Нет сети' })], 2026);
    expect(merged).toEqual({ status: 'done', result: { source: 'youtube', tracks: [], error: err } });
  });
  it('один с ошибкой, другой с треками — треки без ошибки', () => {
    const merged = mergeGenreStatuses('youtube', [done([], { kind: 'offline', message: 'Нет сети' }), done([yt('bbbbbbbbbbb', 'Трек', 'B', 150)])], 2026);
    expect(merged).toEqual({ status: 'done', result: { source: 'youtube', tracks: [yt('bbbbbbbbbbb', 'Трек', 'B', 150)] } });
  });
});
