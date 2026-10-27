import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaUrl, parseRange, resolveMediaRequest, type MediaRoots } from './protocol';

let base: string;
let allowed: string;
let roots: MediaRoots;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'aura-protocol-'));
  allowed = join(base, 'allowed');
  mkdirSync(join(allowed, 'sub'), { recursive: true });
  mkdirSync(join(base, 'outside'), { recursive: true });
  mkdirSync(join(base, 'allowed-evil'), { recursive: true });
  writeFileSync(join(allowed, 'song.mp3'), Buffer.alloc(1000, 1));
  writeFileSync(join(allowed, 'sub', 'cover.jpg'), Buffer.alloc(10, 2));
  writeFileSync(join(allowed, 'notes.txt'), 'секрет');
  writeFileSync(join(base, 'outside', 'secret.mp3'), Buffer.alloc(10, 3));
  writeFileSync(join(base, 'allowed-evil', 'a.mp3'), Buffer.alloc(10, 4));
  writeFileSync(join(base, 'single.mp3'), Buffer.alloc(10, 5));
  // Junction (на Windows создаётся без прав администратора) внутри разрешённой папки — наружу.
  symlinkSync(join(base, 'outside'), join(allowed, 'link'), 'junction');
  roots = { dirs: [allowed], files: [join(base, 'single.mp3')] };
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const raw = (path: string): string => `aura-media://file/${path}`;

describe('resolveMediaRequest', () => {
  it('отдаёт аудиофайл из разрешённой папки и вложенных папок', async () => {
    const res = await resolveMediaRequest(mediaUrl(join(allowed, 'song.mp3')), roots);
    expect(res).toMatchObject({ ok: true, size: 1000, mime: 'audio/mpeg' });
    const cover = await resolveMediaRequest(mediaUrl(join(allowed, 'sub', 'cover.jpg')), roots);
    expect(cover).toMatchObject({ ok: true, mime: 'image/jpeg' });
  });

  it('регистр букв пути на Windows не важен', async () => {
    const res = await resolveMediaRequest(mediaUrl(join(allowed, 'SONG.MP3').toUpperCase()), roots);
    expect(res.ok).toBe(true);
  });

  it('отдельно разрешённый файл (запись загрузок вне текущей папки) — можно', async () => {
    expect((await resolveMediaRequest(mediaUrl(join(base, 'single.mp3')), roots)).ok).toBe(true);
  });

  it('файл вне разрешённых папок — 403', async () => {
    expect(await resolveMediaRequest(mediaUrl(join(base, 'outside', 'secret.mp3')), roots)).toEqual({ ok: false, status: 403 });
  });

  it('выход через «..» — 403, в том числе закодированный', async () => {
    const dotted = `${allowed}\\..\\outside\\secret.mp3`;
    expect(await resolveMediaRequest(mediaUrl(dotted), roots)).toEqual({ ok: false, status: 403 });
    const forward = `${allowed}/../outside/secret.mp3`;
    expect(await resolveMediaRequest(mediaUrl(forward), roots)).toEqual({ ok: false, status: 403 });
    const encodedDots = encodeURIComponent(`${allowed}\\`) + '%2e%2e' + encodeURIComponent('\\outside\\secret.mp3');
    expect(await resolveMediaRequest(raw(encodedDots), roots)).toEqual({ ok: false, status: 403 });
  });

  it('двойное кодирование не раскрывается второй раз', async () => {
    const twice = encodeURIComponent(encodeURIComponent(`${allowed}\\..\\outside\\secret.mp3`));
    expect((await resolveMediaRequest(raw(twice), roots)).ok).toBe(false);
  });

  it('соседняя папка с тем же префиксом имени — 403', async () => {
    expect(await resolveMediaRequest(mediaUrl(join(base, 'allowed-evil', 'a.mp3')), roots)).toEqual({ ok: false, status: 403 });
  });

  it('ссылка (junction) из разрешённой папки наружу — 403', async () => {
    expect(await resolveMediaRequest(mediaUrl(join(allowed, 'link', 'secret.mp3')), roots)).toEqual({ ok: false, status: 403 });
  });

  it('UNC, устройство и другой диск — 403', async () => {
    for (const p of ['\\\\server\\share\\a.mp3', '//server/share/a.mp3', '\\\\?\\C:\\a.mp3', '\\\\.\\C:\\a.mp3']) {
      expect(await resolveMediaRequest(mediaUrl(p), roots)).toEqual({ ok: false, status: 403 });
    }
    const otherDrive = allowed.toUpperCase().startsWith('Z:') ? 'Y:\\a.mp3' : 'Z:\\a.mp3';
    expect(await resolveMediaRequest(mediaUrl(otherDrive), roots)).toEqual({ ok: false, status: 403 });
  });

  it('относительный путь, папка, не аудио/картинка, поток NTFS — 403', async () => {
    expect((await resolveMediaRequest(mediaUrl('song.mp3'), roots)).ok).toBe(false);
    expect(await resolveMediaRequest(mediaUrl(allowed), roots)).toEqual({ ok: false, status: 403 });
    expect(await resolveMediaRequest(mediaUrl(join(allowed, 'sub')), roots)).toEqual({ ok: false, status: 403 });
    expect(await resolveMediaRequest(mediaUrl(join(allowed, 'notes.txt')), roots)).toEqual({ ok: false, status: 403 });
    expect(await resolveMediaRequest(mediaUrl(`${join(allowed, 'song.mp3')}:evil`), roots)).toEqual({ ok: false, status: 403 });
  });

  it('чужой хост, битая кодировка и NUL — отказ', async () => {
    expect((await resolveMediaRequest(`aura-media://other/${encodeURIComponent(join(allowed, 'song.mp3'))}`, roots)).ok).toBe(false);
    expect((await resolveMediaRequest(raw('%E0%A4%A'), roots)).ok).toBe(false);
    expect((await resolveMediaRequest(mediaUrl(`${join(allowed, 'song.mp3')}\u0000.jpg`), roots)).ok).toBe(false);
  });

  it('несуществующий файл в разрешённой папке — 404', async () => {
    expect(await resolveMediaRequest(mediaUrl(join(allowed, 'nope.mp3')), roots)).toEqual({ ok: false, status: 404 });
  });

  it('без разрешённых папок не отдаётся ничего', async () => {
    expect((await resolveMediaRequest(mediaUrl(join(allowed, 'song.mp3')), { dirs: [] })).ok).toBe(false);
  });
});

describe('parseRange', () => {
  it('без заголовка или с непонятным — весь файл', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });

  it('обычный, открытый и суффиксный диапазоны', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });

  it('за пределами файла — неудовлетворимый', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=500-100', 1000)).toBe('unsatisfiable');
  });
});
