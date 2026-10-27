import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../shared/settings';
import filesFlac from './__fixtures__/archive-files-flac.json';
import filesNetlabel from './__fixtures__/archive-files-netlabel.json';
import searchSample from './__fixtures__/archive-search.json';
import { archiveStreamUrl, createArchiveAdapter, parseArchiveFiles, parseArchiveSearch } from './archive';
import type { SourceContext } from './types';

const ctx: SourceContext = { settings: defaultSettings('C:\\Music\\Aura'), userDataDir: 'C:\\data' };
const NS050 = { identifier: 'NS050', title: 'Another Day, Another Way', creator: 'No-Source Netlabel' };

describe('parseArchiveSearch', () => {
  it('берёт идентификатор, название и автора элементов (автор-массив — через запятую)', () => {
    expect(parseArchiveSearch(searchSample)).toEqual([
      { identifier: 'little_women_0711_librivox', title: 'Little Women', creator: 'Louisa May Alcott, LibriVox' },
      { identifier: 'NS050', title: 'Another Day, Another Way', creator: 'No-Source Netlabel' },
      { identifier: 'wind_in_the_willows_collab_librivox', title: 'The Wind in the Willows', creator: 'Kenneth Grahame' },
    ]);
  });

  it('пустой или битый ответ — пустой список', () => {
    expect(parseArchiveSearch({ response: { docs: [] } })).toEqual([]);
    expect(parseArchiveSearch(null)).toEqual([]);
  });
});

describe('parseArchiveFiles', () => {
  it('MP3-файлы элемента — отдельные треки с потоком, обложкой и тегами файла', () => {
    const tracks = parseArchiveFiles(filesNetlabel, NS050);
    expect(tracks.map((t) => t.title)).toEqual(['Christmas with Mr. Rice', 'Prior To (alt. ver.)', 'Swing Low']);
    expect(tracks[0]).toEqual({
      id: 'archive:NS050/01-NS050-Multi-Panel_Christmas-With-Mr-Rice.mp3',
      source: 'archive',
      sourceId: 'NS050/01-NS050-Multi-Panel_Christmas-With-Mr-Rice.mp3',
      title: 'Christmas with Mr. Rice',
      artist: 'Multi-Panel',
      album: 'Another Day, Another Way',
      durationSec: 240.9,
      coverUrl: 'https://archive.org/services/img/NS050',
      downloadable: true,
      pageUrl: 'https://archive.org/details/NS050',
    });
  });

  it('у FLAC-элемента берётся MP3-производная, длительность «05:23» понимается', () => {
    const tracks = parseArchiveFiles(filesFlac, { identifier: 'gd77', title: 'Cornell 77', creator: 'Grateful Dead' });
    expect(tracks.map((t) => [t.sourceId, t.title, t.durationSec])).toEqual([
      ['gd77/gd1977-05-08d01t01.mp3', 'Turning', 39],
      ['gd77/gd1977-05-08d01t02.mp3', 'Minglewood Blues', 323],
    ]);
    expect(tracks[1].artist).toBe('Grateful Dead');
  });

  it('из нескольких MP3 одной записи остаётся одна (лучшего качества); без тегов — имя файла и автор элемента', () => {
    const meta = {
      result: [
        { name: 'side_a_64kb.mp3', source: 'derivative', format: '64Kbps MP3', original: 'side_a.wav', length: '61.2' },
        { name: 'side_a.wav', source: 'original', format: 'WAVE' },
        { name: 'side_a.mp3', source: 'derivative', format: 'VBR MP3', original: 'side_a.wav', length: '61.2' },
      ],
    };
    const tracks = parseArchiveFiles(meta, { identifier: 'tape', title: 'Old Tape', creator: '' });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].sourceId).toBe('tape/side_a.mp3');
    expect(tracks[0].title).toBe('side_a');
    expect(tracks[0].artist).toBe('Неизвестный исполнитель');
    expect(tracks[0].album).toBe('Old Tape');
  });

  it('теги в «кракозябрах» (UTF-8, прочитанный как Latin-1) восстанавливаются', () => {
    const meta = {
      result: [{ name: '03_serocell=fanā6.mp3', format: 'VBR MP3', source: 'original', title: 'fanÄ\u00816', artist: 'Ð\u0091Ð¸' }],
    };
    const [t] = parseArchiveFiles(meta, { identifier: 'UN0321', title: 'somewhen', creator: '' });
    expect(t.title).toBe('fanā6');
    expect(t.artist).toBe('Би');
  });

  it('ограничивает число треков с элемента', () => {
    expect(parseArchiveFiles(filesNetlabel, NS050, 2)).toHaveLength(2);
  });
});

describe('archiveStreamUrl', () => {
  it('ведёт на archive.org/download/{id}/{файл} с кодированием имени, но не слэшей', () => {
    expect(archiveStreamUrl('NS050/Disc 1/01 Intro #1.mp3')).toBe(
      'https://archive.org/download/NS050/Disc%201/01%20Intro%20%231.mp3',
    );
  });
});

describe('адаптер Internet Archive', () => {
  it('поиск: advancedsearch по аудио → файлы каждого элемента; упавший элемент не мешает остальным', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('advancedsearch.php')) return searchSample;
      if (url.includes('/metadata/NS050')) return filesNetlabel;
      throw new Error('нет такого элемента');
    });
    const archive = createArchiveAdapter(fetchJson);
    const tracks = await archive.search('piano', ctx);
    expect(tracks.map((t) => t.title)).toEqual(['Christmas with Mr. Rice', 'Prior To (alt. ver.)', 'Swing Low']);

    const searchUrl = new URL(fetchJson.mock.calls[0][0]);
    expect(searchUrl.origin + searchUrl.pathname).toBe('https://archive.org/advancedsearch.php');
    const q = searchUrl.searchParams.get('q') ?? '';
    expect(q).toContain('piano');
    expect(q).toContain('mediatype:(audio)');
    expect(searchUrl.searchParams.get('output')).toBe('json');
  });

  it('спецсимволы запроса не ломают синтаксис поиска', async () => {
    const fetchJson = vi.fn(async (_url: string) => ({ response: { docs: [] } }));
    const archive = createArchiveAdapter(fetchJson);
    expect(await archive.search('AC/DC "live" (1979)', ctx)).toEqual([]);
    const q = new URL(fetchJson.mock.calls[0][0]).searchParams.get('q') ?? '';
    expect(q).not.toMatch(/[/"]/);
    expect(q).toContain('AC DC live 1979');
  });

  it('поток трека — ссылка на файл элемента', async () => {
    const archive = createArchiveAdapter(vi.fn());
    const [track] = parseArchiveFiles(filesNetlabel, NS050);
    expect(await archive.resolveStream(track, ctx)).toBe(
      'https://archive.org/download/NS050/01-NS050-Multi-Panel_Christmas-With-Mr-Rice.mp3',
    );
  });
});

describe('archive.download', () => {
  it('качает файл элемента по ссылке download/{id}/{файл}', async () => {
    const fetchFile = vi.fn(async (_url: string, dest: string) => dest);
    const adapter = createArchiveAdapter(vi.fn(), fetchFile);
    const track = { id: 'archive:it/a b.mp3', source: 'archive' as const, sourceId: 'it/a b.mp3', title: 'a', artist: 'b', downloadable: true };
    const ctx: SourceContext = { settings: defaultSettings('D:/Music/Aura'), userDataDir: 'D:/data' };
    const out = await adapter.download!(track, 'D:/dl/x.part', ctx, () => undefined, new AbortController().signal);
    expect(out).toBe('D:/dl/x.part');
    expect(fetchFile.mock.calls[0][0]).toBe('https://archive.org/download/it/a%20b.mp3');
  });
});
