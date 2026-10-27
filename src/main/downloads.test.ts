import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../shared/settings';
import type { DownloadRecord, DownloadState, Track } from '../shared/types';
import { createDownloadManager, type DownloadManager } from './downloads';
import { SourceError, type SourceAdapter, type SourceContext } from './sources/types';

type DownloadFn = NonNullable<SourceAdapter['download']>;

interface Pending {
  track: Track;
  destPath: string;
  onProgress(p: number): void;
  signal: AbortSignal;
  finish(content?: string): Promise<void>;
  fail(err: unknown): void;
}

let dir: string;
let dlDir: string;
let states: DownloadState[];
let saved: DownloadRecord[] | null;
let pending: Pending[];
let manager: DownloadManager;

const track = (id: string, patch: Partial<Track> = {}): Track => ({
  id: `archive:${id}`,
  source: 'archive',
  sourceId: `item/${id}.mp3`,
  title: `Песня ${id}`,
  artist: 'Исполнитель',
  downloadable: true,
  ...patch,
});

/** Загрузка, которой управляет тест: пишет в destPath и ждёт finish/fail. */
const fakeDownload: DownloadFn = (t, destPath, _ctx, onProgress, signal) =>
  new Promise<string>((resolve, reject) => {
    void writeFile(destPath, 'частично').then(() => {
      const p: Pending = {
        track: t,
        destPath,
        onProgress,
        signal,
        async finish(content = 'аудио') {
          await writeFile(destPath, content);
          resolve(destPath);
        },
        fail: reject,
      };
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      pending.push(p);
    });
  });

const until = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`не дождались: ${what}`);
};

const statesOf = (trackId: string) => states.filter((s) => s.trackId === trackId).map((s) => s.status);
const lastState = (trackId: string) => states.filter((s) => s.trackId === trackId).at(-1);

function make(download: DownloadFn | null = fakeDownload, records: unknown = null): DownloadManager {
  const ctx: SourceContext = { settings: { ...defaultSettings(dlDir) }, userDataDir: dir };
  return createDownloadManager({
    context: async () => ctx,
    downloaderFor: () => download ?? undefined,
    readRecords: async () => records,
    writeRecords: async (r) => {
      saved = r;
    },
    emit: (s) => states.push(s),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aura-downloads-'));
  dlDir = join(dir, 'Музыка', 'Aura');
  states = [];
  saved = null;
  pending = [];
  manager = make();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('downloads: скачивание', () => {
  it('файл «Исполнитель — Название.mp3» в папке из настроек, запись и состояния', async () => {
    await manager.start(track('a'));
    await until(() => pending.length === 1, 'начала загрузки');
    expect(pending[0].destPath.endsWith('.part')).toBe(true);
    pending[0].onProgress(0.5);
    await pending[0].finish();
    await until(() => lastState('archive:a')?.status === 'done', 'готово');

    const file = join(dlDir, 'Исполнитель — Песня a.mp3');
    expect(lastState('archive:a')).toEqual({ trackId: 'archive:a', status: 'done', filePath: file });
    expect(readFileSync(file, 'utf8')).toBe('аудио');
    expect(readdirSync(dlDir)).toEqual(['Исполнитель — Песня a.mp3']); // обрывков .part нет
    expect(statesOf('archive:a')).toEqual(['queued', 'downloading', 'downloading', 'done']);
    const list = await manager.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ trackId: 'archive:a', filePath: file, missing: false, track: { title: 'Песня a' } });
    expect(saved?.map((r) => r.trackId)).toEqual(['archive:a']);
    expect(await manager.findFile('archive:a')).toBe(file);
  });

  it('совпадающее имя получает « (2)», существующий файл не перезаписывается; недопустимые символы заменены', async () => {
    mkdirSync(dlDir, { recursive: true });
    writeFileSync(join(dlDir, 'AC_DC — Back_.mp3'), 'старый');
    await manager.start(track('b', { artist: 'AC/DC', title: 'Back?' }));
    await until(() => pending.length === 1, 'начала загрузки');
    await pending[0].finish('новый');
    await until(() => lastState('archive:b')?.status === 'done', 'готово');
    expect(readFileSync(join(dlDir, 'AC_DC — Back_.mp3'), 'utf8')).toBe('старый');
    expect(readFileSync(join(dlDir, 'AC_DC — Back_ (2).mp3'), 'utf8')).toBe('новый');
  });

  it('одновременно не больше двух загрузок, остальные ждут в очереди', async () => {
    await manager.start(track('1'));
    await manager.start(track('2'));
    await manager.start(track('3'));
    await until(() => pending.length === 2, 'двух загрузок');
    await new Promise((r) => setTimeout(r, 30));
    expect(pending).toHaveLength(2);
    expect(lastState('archive:3')?.status).toBe('queued');
    await pending[0].finish();
    await until(() => pending.length === 3, 'третьей загрузки');
    expect(pending[2].track.id).toBe('archive:3');
  });

  it('отмена посреди загрузки удаляет частичный файл и не создаёт запись', async () => {
    await manager.start(track('c'));
    await until(() => pending.length === 1, 'начала загрузки');
    const part = pending[0].destPath;
    expect(existsSync(part)).toBe(true);
    await manager.cancel('archive:c');
    await until(() => lastState('archive:c')?.status === 'cancelled', 'отмены');
    expect(pending[0].signal.aborted).toBe(true);
    expect(existsSync(part)).toBe(false);
    expect(readdirSync(dlDir)).toEqual([]);
    expect(await manager.list()).toEqual([]);
  });

  it('отмена ждущей в очереди — она не начинается', async () => {
    await manager.start(track('1'));
    await manager.start(track('2'));
    await manager.start(track('3'));
    await manager.cancel('archive:3');
    expect(lastState('archive:3')?.status).toBe('cancelled');
    await until(() => pending.length === 2, 'двух загрузок');
    await pending[0].finish();
    await pending[1].finish();
    await until(() => lastState('archive:2')?.status === 'done', 'готово');
    await new Promise((r) => setTimeout(r, 30));
    expect(pending).toHaveLength(2);
  });

  it('ошибка — состояние с человеческим текстом, частичный файл удалён', async () => {
    await manager.start(track('d'));
    await until(() => pending.length === 1, 'начала загрузки');
    const part = pending[0].destPath;
    pending[0].fail(new SourceError('offline'));
    await until(() => lastState('archive:d')?.status === 'error', 'ошибки');
    expect(lastState('archive:d')).toEqual({ trackId: 'archive:d', status: 'error', message: 'Нет соединения' });
    expect(existsSync(part)).toBe(false);
    expect(await manager.list()).toEqual([]);
  });

  it('нехватка места на диске — понятное сообщение', async () => {
    await manager.start(track('e'));
    await until(() => pending.length === 1, 'начала загрузки');
    pending[0].fail(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }));
    await until(() => lastState('archive:e')?.status === 'error', 'ошибки');
    const s = lastState('archive:e');
    expect(s?.status === 'error' && s.message).toBe('На диске не хватает места');
  });

  it('трек с запретом скачивания и источник без скачивания — отказ без загрузки', async () => {
    await expect(manager.start(track('f', { downloadable: false }))).rejects.toThrow('Автор запретил скачивание');
    const noDownload = make(null);
    await expect(noDownload.start(track('g'))).rejects.toThrow();
    expect(pending).toHaveLength(0);
  });
});

describe('downloads: записи и удаление', () => {
  async function downloaded(id: string): Promise<string> {
    await manager.start(track(id));
    await until(() => pending.some((p) => p.track.id === `archive:${id}`), 'начала загрузки');
    await pending.find((p) => p.track.id === `archive:${id}`)!.finish();
    await until(() => lastState(`archive:${id}`)?.status === 'done', 'готово');
    const s = lastState(`archive:${id}`);
    return s?.status === 'done' ? s.filePath : '';
  }

  it('remove удаляет только файл этой записи и саму запись', async () => {
    const a = await downloaded('a');
    const b = await downloaded('b');
    writeFileSync(join(dlDir, 'чужой.mp3'), 'не трогать');
    await manager.remove('archive:a');
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(true);
    expect(existsSync(join(dlDir, 'чужой.mp3'))).toBe(true);
    expect(existsSync(dlDir)).toBe(true);
    expect((await manager.list()).map((r) => r.trackId)).toEqual(['archive:b']);
    expect(await manager.findFile('archive:a')).toBeNull();
  });

  it('файл, удалённый вручную, — отметка missing; запись убирается без ошибки', async () => {
    const a = await downloaded('a');
    unlinkSync(a); // rmSync в Node 24 на Windows молча не удаляет файлы с не-ASCII именами
    expect((await manager.list())[0]).toMatchObject({ trackId: 'archive:a', missing: true });
    expect(await manager.findFile('archive:a')).toBeNull();
    await manager.remove('archive:a');
    expect(await manager.list()).toEqual([]);
  });

  it('запись, указывающая на папку, папку не удаляет', async () => {
    const folder = join(dir, 'папка');
    mkdirSync(folder);
    writeFileSync(join(folder, 'x.mp3'), 'x');
    const records = { version: 1, records: [{ trackId: 'archive:z', filePath: folder, downloadedAt: 1, track: track('z') }] };
    const m = make(fakeDownload, records);
    await expect(m.remove('archive:z')).rejects.toThrow();
    expect(existsSync(join(folder, 'x.mp3'))).toBe(true);
  });

  it('remove неизвестного трека ничего не удаляет', async () => {
    const a = await downloaded('a');
    await manager.remove('archive:nope');
    expect(existsSync(a)).toBe(true);
  });

  it('записи читаются из сохранённого файла; мусор отбрасывается', async () => {
    const file = join(dir, 'old.mp3');
    writeFileSync(file, 'x');
    const records = {
      version: 1,
      records: [
        { trackId: 'archive:o', filePath: file, downloadedAt: 5, track: track('o') },
        { trackId: 'archive:bad', filePath: 42 },
        'мусор',
      ],
    };
    const m = make(fakeDownload, records);
    const list = await m.list();
    expect(list.map((r) => r.trackId)).toEqual(['archive:o']);
    expect(await m.findFile('archive:o')).toBe(file);
  });

  it('запись источника, которого больше нет (Jamendo), — файл на диске: играет из файла, метка «Файл», удаляется без ошибки', async () => {
    const file = join(dir, 'Исполнитель — Песня j.mp3');
    writeFileSync(file, 'x');
    const jamendo = { ...track('j'), id: 'jamendo:123', source: 'jamendo', sourceId: '123', coverUrl: 'https://img/j.jpg' };
    const m = make(fakeDownload, { version: 1, records: [{ trackId: 'jamendo:123', filePath: file, downloadedAt: 5, track: jamendo }] });
    const [entry] = await m.list();
    expect(entry).toMatchObject({ missing: false, filePath: file });
    expect(entry.track).toMatchObject({ source: 'local', sourceId: file, title: 'Песня j', artist: 'Исполнитель', downloadable: false });
    expect(entry.trackId).toBe(entry.track.id);
    expect(entry.track.id).toBe(`local:${file}`);
    // Старый id (лайки, плейлисты) и новый находят один файл.
    expect(await m.findFile('jamendo:123')).toBe(file);
    expect(await m.findFile(entry.trackId)).toBe(file);
    await m.remove(entry.trackId);
    expect(existsSync(file)).toBe(false);
    expect(await m.list()).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('повторное скачивание уже скачанного не начинает новую загрузку', async () => {
    await downloaded('a');
    const before = pending.length;
    await manager.start(track('a'));
    await new Promise((r) => setTimeout(r, 30));
    expect(pending.length).toBe(before);
    expect(lastState('archive:a')?.status).toBe('done');
  });
});

describe('downloads: один файл — одна запись', () => {
  async function downloadedTrack(t: Track, content = 'аудио'): Promise<string> {
    await manager.start(t);
    await until(() => pending.some((p) => p.track.id === t.id), 'начала загрузки');
    await pending.find((p) => p.track.id === t.id)!.finish(content);
    await until(() => lastState(t.id)?.status === 'done', 'готово');
    const s = lastState(t.id);
    return s?.status === 'done' ? s.filePath : '';
  }

  it('файл A удалён вручную, B с тем же именем не занимает путь A; удаление A не трогает файл B', async () => {
    const a = await downloadedTrack(track('a'), 'звук A');
    unlinkSync(a);
    const b = await downloadedTrack(track('b', { title: 'Песня a' }), 'звук B');
    expect(b.toLowerCase()).not.toBe(a.toLowerCase());
    const list = await manager.list();
    expect(list.find((r) => r.trackId === 'archive:a')?.missing).toBe(true);
    expect(list.find((r) => r.trackId === 'archive:b')?.missing).toBe(false);
    expect(await manager.findFile('archive:a')).toBeNull();
    await manager.remove('archive:a');
    expect(readFileSync(b, 'utf8')).toBe('звук B');
    expect(await manager.findFile('archive:b')).toBe(b);
  });

  it('свой файл пользователя под именем удалённой загрузки — не «скачанная копия» и не удаляется', async () => {
    const a = await downloadedTrack(track('a'), 'звук A');
    unlinkSync(a);
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(a, 'свой файл пользователя, другой размер');
    expect((await manager.list())[0]).toMatchObject({ trackId: 'archive:a', missing: true });
    expect(await manager.findFile('archive:a')).toBeNull();
    await manager.remove('archive:a');
    expect(readFileSync(a, 'utf8')).toBe('свой файл пользователя, другой размер');
    expect(await manager.list()).toEqual([]);
  });

  it('старые записи с тем же путём (разный регистр) снимаются новой записью', async () => {
    mkdirSync(dlDir, { recursive: true });
    const lower = join(dlDir, 'исполнитель — песня b.mp3');
    const records = { version: 1, records: [{ trackId: 'archive:old', filePath: lower, downloadedAt: 1, track: track('old') }] };
    const m = make(fakeDownload, records);
    await m.start(track('b'));
    await until(() => pending.length === 1, 'начала загрузки');
    await pending[0].finish();
    await until(() => lastState('archive:b')?.status === 'done', 'готово');
    const paths = (await m.list()).map((r) => r.filePath.toLowerCase());
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('downloads: сбой чтения downloads.json', () => {
  const lockError = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });

  function withReader(readRecords: () => Promise<unknown>): DownloadManager {
    const ctx: SourceContext = { settings: { ...defaultSettings(dlDir) }, userDataDir: dir };
    return createDownloadManager({
      context: async () => ctx,
      downloaderFor: () => fakeDownload,
      readRecords,
      writeRecords: async (r) => {
        saved = r;
      },
      emit: (s) => states.push(s),
    });
  }

  it('неудачное чтение не кэширует пустой список — следующее чтение видит записи', async () => {
    const file = join(dir, 'old.mp3');
    writeFileSync(file, 'x');
    const stored = { version: 1, records: [{ trackId: 'archive:o', filePath: file, downloadedAt: 5, track: track('o') }] };
    let reads = 0;
    const m = withReader(async () => {
      reads++;
      if (reads === 1) throw lockError();
      return stored;
    });
    await expect(m.list()).rejects.toThrow();
    expect((await m.list()).map((r) => r.trackId)).toEqual(['archive:o']);
  });

  it('файл так и не прочитался — завершённая загрузка не перезаписывает его списком из одной записи', async () => {
    const m = withReader(async () => {
      throw lockError();
    });
    const started = await m.start(track('a')).then(
      () => true,
      () => false,
    );
    // start мог отказать сразу (список не прочитан) — тогда загрузки нет вовсе; иначе она закончится ошибкой.
    if (started) {
      await until(() => pending.length === 1 || lastState('archive:a')?.status === 'error', 'начала загрузки или ошибки');
      if (pending.length === 1) await pending[0].finish();
      await until(() => lastState('archive:a')?.status === 'error', 'ошибки');
    }
    expect(saved).toBeNull();
    expect(existsSync(dlDir) ? readdirSync(dlDir) : []).toEqual([]);
  });
});

describe('downloads: выход посреди загрузки', () => {
  it('cancelAll отменяет идущие и ждущие загрузки и дожидается уборки частичных файлов', async () => {
    await manager.start(track('1'));
    await manager.start(track('2'));
    await manager.start(track('3'));
    await until(() => pending.length === 2, 'двух загрузок');
    await manager.cancelAll();
    expect(pending.every((p) => p.signal.aborted)).toBe(true);
    expect(['archive:1', 'archive:2', 'archive:3'].map((id) => lastState(id)?.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(readdirSync(dlDir)).toEqual([]);
    expect(saved).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(pending).toHaveLength(2); // ждущая в очереди так и не началась
  });

  it('cancelAll не ждёт дольше заданного, даже если загрузка не реагирует на отмену', async () => {
    const stuck: DownloadFn = (_t, destPath) => writeFile(destPath, 'x').then(() => new Promise<string>(() => undefined));
    const m = make(stuck);
    await m.start(track('s'));
    await until(() => existsSync(dlDir) && readdirSync(dlDir).length === 1, 'начала загрузки');
    const t0 = Date.now();
    await m.cancelAll(60);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('sweepLeftovers удаляет обрывки *.<8hex>.part* в папке скачивания и не трогает остальное', async () => {
    mkdirSync(dlDir, { recursive: true });
    const junk = [
      'Исполнитель — Песня.0123abcd.part',
      'Исполнитель — Песня.89abcdef.part.m4a.part',
      'Исполнитель — Песня.89abcdef.part.m4a',
      'Исполнитель — Песня.89abcdef.part.m4a.ytdl',
      'Исполнитель — Песня.deadbeef.part-Frag3',
    ];
    const keep = ['Исполнитель — Песня.mp3', 'заметки.part', 'Песня.ABCDEFGH.part', 'Песня.0123abc.part', 'Песня.0123abcd.mp3', 'Песня-0123abcd-part'];
    for (const name of [...junk, ...keep]) writeFileSync(join(dlDir, name), 'x');
    mkdirSync(join(dlDir, 'Папка.0123abcd.part'));
    await manager.sweepLeftovers();
    expect(readdirSync(dlDir).sort()).toEqual([...keep, 'Папка.0123abcd.part'].sort());
  });

  it('sweepLeftovers не трогает частичный файл идущей загрузки', async () => {
    await manager.start(track('a'));
    await until(() => pending.length === 1, 'начала загрузки');
    await manager.sweepLeftovers();
    expect(existsSync(pending[0].destPath)).toBe(true);
    await pending[0].finish();
    await until(() => lastState('archive:a')?.status === 'done', 'готово');
  });
});
