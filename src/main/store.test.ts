import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Чтение может упираться во временную блокировку файла (антивирус, OneDrive): тест задаёт,
// сколько ближайших чтений упадут и с каким кодом.
const readFailures = vi.hoisted(() => ({ left: 0, code: 'EBUSY' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    readFile: (async (...args: Parameters<typeof real.readFile>) => {
      if (readFailures.left > 0) {
        readFailures.left--;
        throw Object.assign(new Error(readFailures.code), { code: readFailures.code });
      }
      return real.readFile(...args);
    }) as typeof real.readFile,
  };
});
import { createJsonStore, flushWrites, readJson, setStoreDir, writeJson } from './store';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aura-store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createJsonStore', () => {
  it('нет файла — возвращается fallback, .bak не создаётся', async () => {
    const store = createJsonStore(dir);
    expect(await store.readJson('library.json', { empty: true })).toEqual({ empty: true });
    expect(await readdir(dir)).toEqual([]);
  });

  it('запись и чтение', async () => {
    const store = createJsonStore(dir);
    await store.writeJson('settings.json', { version: 1, volume: 0.4, name: 'Аура' });
    expect(await store.readJson('settings.json', null)).toEqual({ version: 1, volume: 0.4, name: 'Аура' });
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ version: 1, volume: 0.4, name: 'Аура' });
  });

  it('после записи не остаётся временных файлов, перезапись заменяет содержимое', async () => {
    const store = createJsonStore(dir);
    await store.writeJson('library.json', { n: 1 });
    await store.writeJson('library.json', { n: 2 });
    expect(await readdir(dir)).toEqual(['library.json']);
    expect(await store.readJson('library.json', null)).toEqual({ n: 2 });
  });

  it('параллельные записи одного файла не портят его — побеждает последняя', async () => {
    const store = createJsonStore(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.writeJson('library.json', { n: i, pad: 'x'.repeat(5000) })));
    expect((await store.readJson<{ n: number }>('library.json', { n: -1 })).n).toBe(19);
    expect(await readdir(dir)).toEqual(['library.json']);
  });

  it('повреждённый файл откладывается в .bak, возвращается fallback', async () => {
    await writeFile(join(dir, 'library.json'), '{"version":1,"playl', 'utf8');
    const store = createJsonStore(dir);
    expect(await store.readJson('library.json', { fresh: true })).toEqual({ fresh: true });
    expect((await readdir(dir)).sort()).toEqual(['library.json.bak']);
    expect(await readFile(join(dir, 'library.json.bak'), 'utf8')).toBe('{"version":1,"playl');
  });

  it('пустой файл (обрыв записи) тоже считается повреждённым', async () => {
    await writeFile(join(dir, 'settings.json'), '', 'utf8');
    const store = createJsonStore(dir);
    expect(await store.readJson('settings.json', 'def')).toBe('def');
    expect(await readdir(dir)).toEqual(['settings.json.bak']);
  });

  it('создаёт папку, если её нет', async () => {
    const store = createJsonStore(join(dir, 'nested', 'deeper'));
    await store.writeJson('x.json', [1, 2, 3]);
    expect(await store.readJson('x.json', [])).toEqual([1, 2, 3]);
  });
});

describe('readJson / writeJson по папке userData', () => {
  it('работают после setStoreDir', async () => {
    setStoreDir(dir);
    await writeJson('downloads.json', [{ trackId: 'a' }]);
    expect(await readJson('downloads.json', [])).toEqual([{ trackId: 'a' }]);
  });
});

describe('flushWrites', () => {
  it('дожидается всех идущих записей (перед выходом из приложения)', async () => {
    const a = createJsonStore(dir);
    const b = createJsonStore(join(dir, 'other'));
    void a.writeJson('settings.json', { volume: 0.35 });
    void b.writeJson('library.json', { n: 1 });
    void a.writeJson('settings.json', { volume: 0.2 });
    await flushWrites();
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ volume: 0.2 });
    expect(JSON.parse(await readFile(join(dir, 'other', 'library.json'), 'utf8'))).toEqual({ n: 1 });
  });
  it('без записей завершается сразу', async () => {
    await expect(flushWrites()).resolves.toBeUndefined();
  });
});

describe('readJson при временной блокировке файла', () => {
  it('EBUSY/EPERM/EACCES — чтение повторяется и возвращает данные', async () => {
    await writeFile(join(dir, 'library.json'), JSON.stringify({ n: 7 }), 'utf8');
    const store = createJsonStore(dir);
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      readFailures.code = code;
      readFailures.left = 3;
      expect(await store.readJson('library.json', { n: -1 })).toEqual({ n: 7 });
    }
  });

  it('файл так и не прочитался — ошибка, а не заглушка; файл не тронут', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ volume: 0.3 }), 'utf8');
    const store = createJsonStore(dir);
    readFailures.code = 'EBUSY';
    readFailures.left = 1000;
    await expect(store.readJson('settings.json', { volume: 1 })).rejects.toMatchObject({ code: 'EBUSY' });
    readFailures.left = 0;
    expect(await readdir(dir)).toEqual(['settings.json']);
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ volume: 0.3 });
  });
});
