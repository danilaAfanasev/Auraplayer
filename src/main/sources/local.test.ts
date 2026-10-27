import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/settings';
import { mediaUrl } from '../protocol';
import { createLocalLibrary, scanFolders, type LocalIndex } from './local';
import type { SourceContext } from './types';

// ---- минимальный MP3 с тегами ID3v2.4 (UTF-8) и обложкой ----
const syncsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const frame = (id: string, data: Buffer) => Buffer.concat([Buffer.from(id, 'latin1'), syncsafe(data.length), Buffer.from([0, 0]), data]);
const text = (id: string, value: string) => frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]));
// PNG 1×1
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);
function taggedMp3(tags: { title: string; artist: string; album: string; genre?: string }, cover = true): Buffer {
  const frames = [text('TIT2', tags.title), text('TPE1', tags.artist), text('TALB', tags.album)];
  if (tags.genre) frames.push(text('TCON', tags.genre));
  if (cover) frames.push(frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), PNG])));
  const body = Buffer.concat(frames);
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([4, 0, 0]), syncsafe(body.length)]);
  return Buffer.concat([header, body, Buffer.alloc(64)]);
}

let dir: string;
let music: string;
let covers: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aura-local-'));
  music = join(dir, 'Музыка');
  covers = join(dir, 'userData', 'covers');
  mkdirSync(join(music, 'Альбом', 'CD1'), { recursive: true });
  writeFileSync(join(music, 'Альбом', 'CD1', '01 трек.mp3'), taggedMp3({ title: 'Ночь', artist: 'Кино', album: 'Звезда', genre: 'Rock' }));
  writeFileSync(join(music, 'Без тегов — песня.FLAC'), Buffer.alloc(32));
  writeFileSync(join(music, 'запись.wav'), Buffer.alloc(16));
  for (const ext of ['m4a', 'ogg', 'opus']) writeFileSync(join(music, `f.${ext}`), Buffer.alloc(8));
  writeFileSync(join(music, 'обложка.jpg'), PNG);
  writeFileSync(join(music, 'readme.txt'), 'не музыка');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scanFolders', () => {
  it('рекурсивно находит mp3, m4a, flac, ogg, opus, wav и ничего больше', async () => {
    const { tracks } = await scanFolders([music], { coversDir: covers });
    const names = tracks.map((t) => t.sourceId.slice(music.length + 1)).sort();
    expect(names).toEqual(
      ['Альбом\\CD1\\01 трек.mp3', 'Без тегов — песня.FLAC', 'f.m4a', 'f.ogg', 'f.opus', 'запись.wav'].sort(),
    );
    for (const t of tracks) {
      expect(t).toMatchObject({ source: 'local', id: `local:${t.sourceId}`, downloadable: false });
    }
  });

  it('теги и обложка из файла; обложка кэшируется в covers и отдаётся через aura-media', async () => {
    const { tracks } = await scanFolders([music], { coversDir: covers });
    const tagged = tracks.find((t) => t.sourceId.endsWith('01 трек.mp3'))!;
    expect(tagged).toMatchObject({ title: 'Ночь', artist: 'Кино', album: 'Звезда', tags: ['Rock'] });
    expect(tagged.coverUrl?.startsWith('aura-media://file/')).toBe(true);
    const coverPath = decodeURIComponent(tagged.coverUrl!.slice('aura-media://file/'.length));
    expect(coverPath.startsWith(covers)).toBe(true);
    expect(existsSync(coverPath)).toBe(true);
  });

  it('без тегов — название из имени файла', async () => {
    const { tracks } = await scanFolders([music], { coversDir: covers });
    const plain = tracks.find((t) => t.sourceId.endsWith('.FLAC'))!;
    expect(plain.title).toBe('Без тегов — песня');
    expect(plain.artist).toBe('Неизвестный исполнитель');
    expect(plain.coverUrl).toBeUndefined();
  });

  it('несуществующая папка не роняет сканирование', async () => {
    const { tracks } = await scanFolders([join(dir, 'нет такой'), music], { coversDir: covers });
    expect(tracks.length).toBe(6);
  });
});

describe('createLocalLibrary', () => {
  let stored: LocalIndex | null;
  const ctx = (folders: string[]): SourceContext => ({
    settings: { ...defaultSettings(join(dir, 'dl')), localFolders: folders },
    userDataDir: join(dir, 'userData'),
  });
  const make = () =>
    createLocalLibrary({
      readIndex: async () => stored,
      writeIndex: async (i) => {
        stored = i;
      },
    });

  beforeEach(() => {
    stored = null;
  });

  it('пересканирование сохраняет индекс; треки и поиск берутся из него', async () => {
    const lib = make();
    expect(await lib.rescan(ctx([music]))).toHaveLength(6);
    expect(stored).not.toBeNull();
    const again = make(); // новый запуск приложения — индекс с диска
    expect(await again.tracks(ctx([music]))).toHaveLength(6);
    const found = await again.adapter.search('кино ночь', ctx([music]));
    expect(found.map((t) => t.title)).toEqual(['Ночь']);
    expect(await again.adapter.search('звезда', ctx([music]))).toHaveLength(1);
    expect(await again.adapter.search('nothing', ctx([music]))).toHaveLength(0);
  });

  it('папка, убранная из списка, пропадает из треков, а файлы остаются на диске', async () => {
    const lib = make();
    await lib.rescan(ctx([music]));
    expect(await lib.tracks(ctx([]))).toEqual([]);
    expect(await lib.adapter.search('ночь', ctx([]))).toEqual([]);
    expect(existsSync(join(music, 'Альбом', 'CD1', '01 трек.mp3'))).toBe(true);
  });

  it('удалённый с диска файл — отметка missing, поток — «Файл не найден»', async () => {
    const lib = make();
    await lib.rescan(ctx([music]));
    const file = join(music, 'запись.wav');
    unlinkSync(file);
    const t = (await lib.tracks(ctx([music]))).find((x) => x.sourceId === file)!;
    expect(t.missing).toBe(true);
    await expect(lib.adapter.resolveStream(t, ctx([music]))).rejects.toThrow('Файл не найден');
  });

  it('поток — aura-media URL файла; путь вне папок «Моих файлов» не отдаётся', async () => {
    const lib = make();
    const tracks = await lib.rescan(ctx([music]));
    const t = tracks.find((x) => x.sourceId.endsWith('f.ogg'))!;
    expect(await lib.adapter.resolveStream(t, ctx([music]))).toBe(mediaUrl(t.sourceId));
    const outside = { ...t, id: 'local:C:\\Windows\\win.ini', sourceId: 'C:\\Windows\\win.ini' };
    await expect(lib.adapter.resolveStream(outside, ctx([music]))).rejects.toThrow();
  });
});
