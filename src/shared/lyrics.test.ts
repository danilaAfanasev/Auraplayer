import { describe, expect, it } from 'vitest';
import candidates from '../main/sources/__fixtures__/lrclib-search-candidates.json';
import getSynced from '../main/sources/__fixtures__/lrclib-get-synced.json';
import instrumental from '../main/sources/__fixtures__/lrclib-search-instrumental.json';
import {
  lineIndexAt,
  lyricsFromRecord,
  lyricsKey,
  lyricsQuery,
  parseLrc,
  parseLyricsRecord,
  parseLyricsRecords,
  pickLyricsRecord,
  type LyricsRecord,
} from './lyrics';
import type { Track } from './types';

const track = (over: Partial<Track> = {}): Track => ({
  id: 'youtube:abc',
  source: 'youtube',
  sourceId: 'abc',
  title: 'Stronger',
  artist: 'Kanye West',
  downloadable: true,
  ...over,
});

describe('parseLrc', () => {
  it('разбирает метки с сотыми и тысячными, время в секундах', () => {
    expect(parseLrc('[00:12.50] Привет\n[01:03.250]Мир\n[02:00] Конец')).toEqual([
      { timeSec: 12.5, text: 'Привет' },
      { timeSec: 63.25, text: 'Мир' },
      { timeSec: 120, text: 'Конец' },
    ]);
  });

  it('несколько меток на строке дают несколько строк, итог упорядочен по времени', () => {
    expect(parseLrc('[00:30.00][00:10.00]Припев\n[00:20.00]Куплет')).toEqual([
      { timeSec: 10, text: 'Припев' },
      { timeSec: 20, text: 'Куплет' },
      { timeSec: 30, text: 'Припев' },
    ]);
  });

  it('пустая строка с меткой — пауза, остаётся', () => {
    expect(parseLrc('[00:05.00] Раз\n[00:08.00]\n[00:09.00]  \n[00:12.00] Два')).toEqual([
      { timeSec: 5, text: 'Раз' },
      { timeSec: 8, text: '' },
      { timeSec: 9, text: '' },
      { timeSec: 12, text: 'Два' },
    ]);
  });

  it('метки вида [ar:…], строки без меток и пустой ввод не дают строк', () => {
    expect(parseLrc('[ar:Кто-то]\n[ti:Название]\nпросто текст\n\n')).toEqual([]);
    expect(parseLrc('')).toEqual([]);
  });

  it('пословные метки <00:01.00> убирает из текста, переводы строк \\r\\n терпит', () => {
    expect(parseLrc('[00:01.00] <00:01.00>Один <00:01.50>два\r\n[00:03.00] три')).toEqual([
      { timeSec: 1, text: 'Один два' },
      { timeSec: 3, text: 'три' },
    ]);
  });
});

describe('lyricsQuery', () => {
  it('чистит «(feat. X)», «[Official Video]» и берёт основного исполнителя', () => {
    const q = lyricsQuery(track({ title: 'Song (feat. Guest) [Official Video]', artist: 'Main Artist & Other', album: ' Album ', durationSec: 201.6 }));
    expect(q).toEqual({ artist: 'Main Artist', title: 'Song', album: 'Album', durationSec: 202 });
  });

  it('убирает «speed up», «slowed + reverb» и хвосты после тире', () => {
    expect(lyricsQuery(track({ title: 'Baby My Type (speed up)' })).title).toBe('Baby My Type');
    expect(lyricsQuery(track({ title: 'Раны - Slowed + Reverb' })).title).toBe('Раны');
    expect(lyricsQuery(track({ title: 'Stronger | Official Audio' })).title).toBe('Stronger');
    expect(lyricsQuery(track({ title: 'Song - 2011 Remaster' })).title).toBe('Song');
  });

  it('«ft. X» без скобок — не часть названия; «Исполнитель - » в начале названия срезается', () => {
    expect(lyricsQuery(track({ title: 'Song ft. Guest' })).title).toBe('Song');
    expect(lyricsQuery(track({ title: 'Kanye West - Stronger', artist: 'Kanye West' })).title).toBe('Stronger');
  });

  it('осмысленная часть названия не страдает: «Remix», тире внутри слова', () => {
    expect(lyricsQuery(track({ title: 'Song - Remix' })).title).toBe('Song - Remix');
    expect(lyricsQuery(track({ title: 'Дни-ночи' })).title).toBe('Дни-ночи');
  });

  it('название из одних скобок не превращается в пустое', () => {
    expect(lyricsQuery(track({ title: '(Intro)' })).title).toBe('(Intro)');
  });

  it('без альбома и длительности полей нет', () => {
    const q = lyricsQuery(track());
    expect(q).toEqual({ artist: 'Kanye West', title: 'Stronger' });
  });
});

describe('lyricsKey', () => {
  it('одна песня с пометками и из разных источников — один ключ', () => {
    const a = lyricsKey(track({ title: 'Stronger', durationSec: 311 }));
    const b = lyricsKey(track({ id: 'catalog:1', source: 'catalog', title: 'Stronger (Official Video)', artist: 'KANYE WEST', durationSec: 312 }));
    expect(a).toBe(b);
  });

  it('другая песня или сильно другая длительность (ускоренная версия) — другой ключ', () => {
    expect(lyricsKey(track({ durationSec: 311 }))).not.toBe(lyricsKey(track({ title: 'Flashing Lights', durationSec: 311 })));
    expect(lyricsKey(track({ durationSec: 311 }))).not.toBe(lyricsKey(track({ durationSec: 250 })));
  });
});

describe('parseLyricsRecord', () => {
  it('читает ответ LRCLIB и отбрасывает мусор', () => {
    expect(parseLyricsRecord(getSynced)).toMatchObject({ id: 1001, trackName: 'Вредные привычки', artistName: 'madk1d', duration: 142, instrumental: false });
    expect(parseLyricsRecord({ message: 'x', statusCode: 503 })).toBeNull();
    expect(parseLyricsRecord(null)).toBeNull();
    expect(parseLyricsRecords(candidates)).toHaveLength(5);
    expect(parseLyricsRecords({ not: 'array' })).toEqual([]);
  });
});

const records = parseLyricsRecords(candidates);
const stronger = { artist: 'Kanye West', title: 'Stronger' };

describe('pickLyricsRecord', () => {
  it('по длительности ±3 с: синхронный предпочтительнее простого, чужие песни отброшены', () => {
    expect(pickLyricsRecord(records, { ...stronger, durationSec: 312 })?.id).toBe(2002);
  });

  it('инструментал, найденный единственным, — запись с instrumental (текста нет)', () => {
    const only = parseLyricsRecords(instrumental);
    const picked = pickLyricsRecord(only, { artist: 'Kai Angel', title: 'GOD SYSTEM', durationSec: 131 });
    expect(picked?.instrumental).toBe(true);
    expect(lyricsFromRecord(picked)).toEqual({ kind: 'none' });
  });

  it('запись с текстом выигрывает у инструментала той же песни', () => {
    const list = [records[2], records[0]];
    expect(pickLyricsRecord(list, { ...stronger, durationSec: 312 })?.id).toBe(2001);
  });

  it('длительность в пределах ±3 с важнее «синхронности» записи в ±5', () => {
    const near: LyricsRecord = { ...records[0], id: 1, duration: 312, syncedLyrics: null };
    const far: LyricsRecord = { ...records[1], id: 2, duration: 316.5 };
    expect(pickLyricsRecord([far, near], { ...stronger, durationSec: 312 })?.id).toBe(1);
    // а когда близкой нет — берётся дальняя (до ±5 с)
    expect(pickLyricsRecord([far], { ...stronger, durationSec: 312 })?.id).toBe(2);
  });

  it('запись меньше чем в 3 непустые строки («probe») проигрывает записи с настоящим текстом — и по длительности, и по «синхронности»', () => {
    const rick = { artist: 'Rick Astley', title: 'Never Gonna Give You Up', durationSec: 213 };
    const base = { trackName: 'Never Gonna Give You Up', artistName: 'Rick Astley', instrumental: false };
    const probe: LyricsRecord = { ...base, id: 1, duration: 213, plainLyrics: 'probe', syncedLyrics: '[00:00.00] probe\n[00:01.00] ' };
    const lyricsText = "We're no strangers to love\nYou know the rules and so do I\n\nA full commitment's what I'm thinking of";
    const plainFar: LyricsRecord = { ...base, id: 2, duration: 217.5, plainLyrics: lyricsText, syncedLyrics: null };
    expect(pickLyricsRecord([probe, plainFar], rick)?.id).toBe(2);
    const plainNear: LyricsRecord = { ...plainFar, id: 3, duration: 213 };
    expect(pickLyricsRecord([probe, plainNear], rick)?.id).toBe(3);
    // одна «probe» — всё равно лучше, чем ничего
    expect(pickLyricsRecord([probe], rick)?.id).toBe(1);
  });

  it('длительность дальше ±5 с — подходящих нет', () => {
    expect(pickLyricsRecord(records, { ...stronger, durationSec: 250 })).toBeNull();
  });

  it('допуск можно сузить: для точного запроса — ±3 с', () => {
    const far: LyricsRecord = { ...records[1], id: 2, duration: 316.5 };
    expect(pickLyricsRecord([far], { ...stronger, durationSec: 312 }, 3)).toBeNull();
  });

  it('без длительности у трека — лучший по названию и исполнителю, альбом решает ничью', () => {
    const both: LyricsRecord[] = [{ ...records[0] }, { ...records[0], id: 9, albumName: 'Graduation' }];
    expect(pickLyricsRecord(both, { ...stronger, album: 'Graduation' })?.id).toBe(9);
  });

  it('название сравнивается без скобок и регистра; исполнитель — любой из соавторов записи', () => {
    const rec: LyricsRecord = { ...records[1], id: 5, trackName: 'STRONGER (Album Version)', artistName: 'Daft Punk, Kanye West' };
    expect(pickLyricsRecord([rec], { ...stronger, durationSec: 311 })?.id).toBe(5);
  });

  it('пустой список и чужой исполнитель — null', () => {
    expect(pickLyricsRecord([], stronger)).toBeNull();
    expect(pickLyricsRecord(records, { artist: 'Nobody', title: 'Stronger' })).toBeNull();
  });
});

describe('lyricsFromRecord', () => {
  it('синхронный текст: строки и простой текст рядом', () => {
    const l = lyricsFromRecord(parseLyricsRecord(getSynced));
    expect(l.kind).toBe('synced');
    if (l.kind !== 'synced') return;
    expect(l.lines).toHaveLength(4);
    expect(l.lines[0]).toEqual({ timeSec: 12.5, text: 'Первая строка образца' });
    expect(l.plain).toContain('Вторая строка образца');
  });

  it('только простой текст — plain; синхронный из одних пауз — тоже plain', () => {
    expect(lyricsFromRecord(records[0])).toEqual({ kind: 'plain', text: 'Plain line one\nPlain line two' });
    expect(lyricsFromRecord({ ...records[0], syncedLyrics: '[00:01.00] \n[00:02.00]' })).toEqual({ kind: 'plain', text: 'Plain line one\nPlain line two' });
  });

  it('инструментал, пустая запись и null — «нет»', () => {
    expect(lyricsFromRecord(records[2])).toEqual({ kind: 'none' });
    expect(lyricsFromRecord({ ...records[0], plainLyrics: '  ', syncedLyrics: null })).toEqual({ kind: 'none' });
    expect(lyricsFromRecord(null)).toEqual({ kind: 'none' });
  });
});

describe('lineIndexAt', () => {
  const lines = [
    { timeSec: 10, text: 'a' },
    { timeSec: 20, text: 'b' },
    { timeSec: 30, text: 'c' },
  ];
  it('индекс последней строки, чьё время уже наступило; до первой — -1', () => {
    expect(lineIndexAt(lines, 5)).toBe(-1);
    expect(lineIndexAt(lines, 10)).toBe(0);
    expect(lineIndexAt(lines, 19.99)).toBe(0);
    expect(lineIndexAt(lines, 20)).toBe(1);
    expect(lineIndexAt(lines, 999)).toBe(2);
    expect(lineIndexAt([], 5)).toBe(-1);
  });
});
