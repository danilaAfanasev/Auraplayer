import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YtDlpProgress } from '../shared/api';
import { configureYtDlp, ensureYtDlp, needsYtDlp, runYtDlp, updateYtDlp, ytDlpVersion, type SpawnFn } from './ytdlp';

interface Call {
  file: string;
  args: string[];
}

let dir: string;
let calls: Call[];
/** Что «напечатает» поддельный yt-dlp: по аргументам — stdout и код выхода. */
let script: (args: string[]) => { stdout?: string; stderr?: string; code?: number };

const fakeSpawn: SpawnFn = (file, args) => {
  calls.push({ file, args: [...args] });
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdout, stderr, kill: () => true, pid: undefined });
  const out = script([...args]);
  setTimeout(() => {
    if (out.stdout) stdout.write(out.stdout);
    if (out.stderr) stderr.write(out.stderr);
    stdout.end();
    stderr.end();
    setTimeout(() => child.emit('close', out.code ?? 0), 5);
  }, 5);
  return child;
};

/** Поддельный exe: заголовок PE и 2 МБ. */
const fakeExe = (): Buffer => {
  const buf = Buffer.alloc(2 * 1024 * 1024);
  buf.write('MZ', 0, 'ascii');
  return buf;
};

const binPath = () => join(dir, 'bin', 'yt-dlp.exe');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aura-ytdlp-'));
  calls = [];
  script = () => ({ stdout: '2026.10.21\n' });
  configureYtDlp({ binDir: join(dir, 'bin'), spawn: fakeSpawn });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const installFake = () => {
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(binPath(), fakeExe());
};

describe('runYtDlp — G01: только анонимно', () => {
  const forbidden = [
    ['--cookies', 'cookies.txt'],
    ['--cookies=cookies.txt'],
    ['--cookies-from-browser', 'chrome'],
    ['--username', 'me'],
    ['-u', 'me'],
    ['--password', 'secret'],
    ['-p', 'secret'],
    ['--netrc'],
    ['-n'],
    ['--netrc-location', 'C:\\x'],
    ['--netrc-cmd', 'x'],
    ['--video-password', 'x'],
    ['--ap-username', 'x'],
    ['--ap-password', 'x'],
    ['--add-headers', 'Cookie: a=b'],
    ['--config-locations', 'C:\\conf'],
    // сокращения длинных опций (optparse их принимает)
    ['--cookies-from', 'chrome'],
    ['--user', 'me'],
    ['--PASSWORD', 'x'],
  ];

  it.each(forbidden)('отвергает %s и не запускает yt-dlp', async (...bad) => {
    installFake();
    await expect(runYtDlp(['--flat-playlist', ...bad, '-J', '--', 'ytsearch5:кино'])).rejects.toThrow(/анонимно|запрещ/i);
    expect(calls).toHaveLength(0);
  });

  it('всегда добавляет --ignore-config, --no-cookies, --no-cookies-from-browser и не передаёт куки/логин', async () => {
    installFake();
    script = () => ({ stdout: '{"ok":true}' });
    const res = await runYtDlp(['-J', '--', 'ytsearch5:кино']);
    expect(res.stdout).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    const args = calls[0].args;
    expect(calls[0].file).toBe(binPath());
    expect(args).toEqual(expect.arrayContaining(['--ignore-config', '--no-cookies', '--no-cookies-from-browser']));
    expect(args.slice(-3)).toEqual(['-J', '--', 'ytsearch5:кино']);
    for (const a of args) expect(a).not.toMatch(/^--(cookies|username|password|netrc)\b/);
    expect(args).not.toContain('-u');
    expect(args).not.toContain('-p');
    expect(args).not.toContain('-n');
  });

  it('ненулевой код выхода — ошибка с последней строкой ERROR', async () => {
    installFake();
    script = () => ({ stderr: 'WARNING: x\nERROR: [youtube] abc: Video unavailable\n', code: 1 });
    await expect(runYtDlp(['-j', '--', 'https://www.youtube.com/watch?v=abcdefghijk'])).rejects.toThrow(/Video unavailable/);
  });
});

/** ZIP «как есть» (без сжатия) из файлов — как официальный `yt-dlp_win.zip`. */
function makeZip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Папочная сборка: exe + библиотеки в `_internal/`. */
const onedirZip = (marker = 'v1'): Buffer =>
  makeZip({ 'yt-dlp.exe': fakeExe(), '_internal/python3.dll': Buffer.from(`python ${marker}`), '_internal/yt_dlp_ejs/core.js': Buffer.from('js') });
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sums = (zip: Buffer) => `${'0'.repeat(64)}  yt-dlp.exe\n${sha256(zip)}  yt-dlp_win.zip\n`;

const internalPath = () => join(dir, 'bin', '_internal');

/** Поддельный GitHub: редирект на версию, архив и суммы. `latest` — тег последнего релиза. */
function fakeGithub(opts: { zip?: Buffer; sumsText?: string; latest?: string } = {}) {
  const urls: string[] = [];
  const zip = opts.zip ?? onedirZip();
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/releases/latest')) {
      return new Response(null, { status: 302, headers: { location: `https://github.com/yt-dlp/yt-dlp/releases/tag/${opts.latest ?? '2026.10.21'}` } });
    }
    if (url.endsWith('/SHA2-256SUMS')) return new Response(opts.sumsText ?? sums(zip));
    if (url.endsWith('/yt-dlp_win.zip')) return new Response(zip, { headers: { 'content-length': String(zip.length) } });
    return new Response('not found', { status: 404 });
  });
  return urls;
}

describe('ensureYtDlp — первая установка (папочная сборка)', () => {
  it('скачивает yt-dlp_win.zip только с официального GitHub, сверяет SHA-256 и ставит exe с _internal в binDir', async () => {
    const urls = fakeGithub();
    const progress: YtDlpProgress[] = [];
    const path = await ensureYtDlp((p) => progress.push(p));
    expect(path).toBe(binPath());
    expect(urls.every((u) => u.startsWith('https://github.com/yt-dlp/yt-dlp/releases/'))).toBe(true);
    expect(urls).toContain('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win.zip');
    expect(urls).toContain('https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS');
    expect(readFileSync(path).subarray(0, 2).toString('ascii')).toBe('MZ');
    expect(readFileSync(join(internalPath(), 'python3.dll'), 'utf8')).toBe('python v1');
    expect(existsSync(join(internalPath(), 'yt_dlp_ejs', 'core.js'))).toBe(true);
    // Временные файлы убраны: в bin только сборка.
    expect(readdirSync(join(dir, 'bin')).sort()).toEqual(['_internal', 'yt-dlp.exe']);
    expect(progress.at(-1)).toEqual({ stage: 'done', progress: 1 });
  });

  it('без сети первая установка падает со стадией error в прогрессе, а повтор после появления сети проходит', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const progress: YtDlpProgress[] = [];
    await expect(ensureYtDlp((p) => progress.push(p))).rejects.toThrow();
    expect(progress.at(-1)).toEqual({ stage: 'error', progress: 0 });
    expect(existsSync(binPath())).toBe(false);
    fakeGithub();
    expect(await ensureYtDlp()).toBe(binPath());
  });

  it('одновременные вызовы скачивают один раз', async () => {
    const urls = fakeGithub();
    const [a, b] = await Promise.all([ensureYtDlp(), ensureYtDlp()]);
    expect(a).toBe(b);
    expect(urls.filter((u) => u.endsWith('.zip'))).toHaveLength(1);
  });

  it('архив не совпал с контрольной суммой GitHub — не устанавливается', async () => {
    fakeGithub({ sumsText: `${'a'.repeat(64)}  yt-dlp_win.zip\n` });
    await expect(ensureYtDlp()).rejects.toThrow(/контрольной суммой/);
    expect(existsSync(binPath())).toBe(false);
  });

  it('в архиве не exe (например, страница ошибки) — не устанавливается', async () => {
    fakeGithub({ zip: makeZip({ 'yt-dlp.exe': Buffer.alloc(2 * 1024 * 1024, 1), '_internal/x.dll': Buffer.from('x') }) });
    await expect(ensureYtDlp()).rejects.toThrow(/yt-dlp/);
    expect(existsSync(binPath())).toBe(false);
  });

  it('файлы архива вне exe и _internal (выход из папки) не распаковываются', async () => {
    fakeGithub({ zip: makeZip({ 'yt-dlp.exe': fakeExe(), '_internal/a.dll': Buffer.from('a'), '../evil.txt': Buffer.from('x'), 'other.txt': Buffer.from('y') }) });
    await ensureYtDlp();
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
    expect(existsSync(join(dir, 'bin', 'other.txt'))).toBe(false);
  });

  it('уже установленная папочная сборка — без сети', async () => {
    installFake();
    mkdirSync(internalPath());
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await ensureYtDlp()).toBe(binPath());
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('однофайловая сборка прошлых версий работает сразу, а папочная ставится в фоне на то же место', async () => {
    installFake(); // однофайловая: exe без _internal
    const urls = fakeGithub();
    script = () => ({ stdout: '{"ok":true}' });
    await expect(runYtDlp(['-J', '--', 'ytsearch5:кино'])).resolves.toMatchObject({ stdout: '{"ok":true}' });
    expect(calls[0].file).toBe(binPath());
    await vi.waitFor(() => expect(existsSync(join(internalPath(), 'python3.dll'))).toBe(true));
    expect(urls.some((u) => u.endsWith('/yt-dlp_win.zip'))).toBe(true);
    expect(existsSync(binPath())).toBe(true);
  });
});

describe('версия и обновление', () => {
  const installOnedir = () => {
    installFake();
    mkdirSync(internalPath());
    writeFileSync(join(internalPath(), 'python3.dll'), 'python old');
  };

  it('ytDlpVersion: null, пока не установлен; иначе вывод --version', async () => {
    expect(await ytDlpVersion()).toBeNull();
    installOnedir();
    expect(await ytDlpVersion()).toBe('2026.10.21');
    expect(calls.at(-1)?.args).toContain('--version');
  });

  it('updateYtDlp: последняя версия на GitHub совпадает — «уже последняя», без скачивания', async () => {
    installOnedir();
    const urls = fakeGithub({ latest: '2026.10.21' });
    expect(await updateYtDlp()).toEqual({ version: '2026.10.21', updated: false });
    expect(urls).toEqual(['https://github.com/yt-dlp/yt-dlp/releases/latest']);
  });

  it('updateYtDlp: на GitHub новее — скачивает эту версию, заменяет exe и _internal, сообщает новую версию', async () => {
    installOnedir();
    let version = '2026.09.01';
    script = (args) => (args.includes('--version') ? { stdout: `${version}\n` } : {});
    expect(await ytDlpVersion()).toBe('2026.09.01');
    const urls = fakeGithub({ zip: onedirZip('v2'), latest: '2026.10.21' });
    version = '2026.10.21';
    expect(await updateYtDlp()).toEqual({ version: '2026.10.21', updated: true });
    expect(urls).toContain('https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_win.zip');
    expect(readFileSync(join(internalPath(), 'python3.dll'), 'utf8')).toBe('python v2');
    expect(await ytDlpVersion()).toBe('2026.10.21');
    expect(readdirSync(join(dir, 'bin')).sort()).toEqual(['_internal', 'yt-dlp.exe']);
  });

  it('updateYtDlp: замена ждёт, пока доработает запущенный yt-dlp', async () => {
    installOnedir();
    let finishLong!: () => void;
    const long = new Promise<void>((r) => (finishLong = r));
    script = (args) => (args.includes('--version') ? { stdout: '2026.09.01\n' } : { stdout: '{}' });
    // Долгий запуск: закрывается, только когда тест разрешит.
    const slowSpawn: SpawnFn = (file, args, options) => {
      if (args.includes('slow')) {
        calls.push({ file, args: [...args] });
        const child = new EventEmitter() as ChildProcess;
        Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true, pid: undefined });
        void long.then(() => child.emit('close', 0));
        return child;
      }
      return fakeSpawn(file, args, options);
    };
    configureYtDlp({ binDir: join(dir, 'bin'), spawn: slowSpawn });
    fakeGithub({ zip: onedirZip('v2'), latest: '2026.10.21' });
    const running = runYtDlp(['--', 'slow']);
    await vi.waitFor(() => expect(calls.some((c) => c.args.includes('slow'))).toBe(true));
    const update = updateYtDlp();
    await new Promise((r) => setTimeout(r, 300));
    expect(readFileSync(join(internalPath(), 'python3.dll'), 'utf8')).toBe('python old');
    finishLong();
    await running;
    await update;
    expect(readFileSync(join(internalPath(), 'python3.dll'), 'utf8')).toBe('python v2');
  });
});

describe('needsYtDlp — готовить yt-dlp при запуске', () => {
  it('нужен, пока включён YouTube или SoundCloud', () => {
    expect(needsYtDlp({ youtubeEnabled: true, soundcloudEnabled: true })).toBe(true);
    expect(needsYtDlp({ youtubeEnabled: true, soundcloudEnabled: false })).toBe(true);
    expect(needsYtDlp({ youtubeEnabled: false, soundcloudEnabled: true })).toBe(true);
  });

  it('оба выключены — не нужен', () => {
    expect(needsYtDlp({ youtubeEnabled: false, soundcloudEnabled: false })).toBe(false);
  });
});
