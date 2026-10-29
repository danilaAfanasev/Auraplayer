import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LATEST_RELEASE_URL } from '../shared/version';
import type { FetchFile } from './sources/fetchFile';
import { SourceError } from './sources/types';
import { createUpdater, INSTALLER_ARGS, installScript, launcherCommand, psQuote, type UpdaterDeps } from './updater';

const BODY = Buffer.from('MZ — поддельный установщик Aura');
const SHA = createHash('sha256').update(BODY).digest('hex');

function releaseJson(over: Record<string, unknown> = {}): unknown {
  return {
    tag_name: 'v0.3.0',
    draft: false,
    prerelease: false,
    body: 'Новое',
    html_url: 'https://github.com/danilaAfanasev/Auraplayer/releases/tag/v0.3.0',
    assets: [
      {
        name: 'Aura-Setup-0.3.0.exe',
        size: BODY.length,
        browser_download_url: 'https://github.com/danilaAfanasev/Auraplayer/releases/download/v0.3.0/Aura-Setup-0.3.0.exe',
        digest: `sha256:${SHA}`,
        ...over,
      },
    ],
  };
}

/** Подставное скачивание: пишет `body` в файл, по пути сообщая прогресс. */
const writingFetch =
  (body: Buffer = BODY): FetchFile =>
  async (_url, dest, onProgress) => {
    onProgress(0);
    onProgress(0.5);
    writeFileSync(dest, body, { flag: 'wx' });
    onProgress(1);
    return dest;
  };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(over: Partial<UpdaterDeps> = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'aura-updater-'));
  dirs.push(tempDir);
  const calls: string[] = [];
  const deps: UpdaterDeps = {
    fetchJson: vi.fn(async () => releaseJson()),
    fetchToFile: vi.fn(writingFetch()),
    spawn: vi.fn((file: string, args: string[]) => {
      calls.push(`spawn ${file} ${args.join(' ')}`);
    }),
    quit: vi.fn(() => {
      calls.push('quit');
    }),
    currentVersion: '0.2.1',
    isPackaged: true,
    tempDir,
    installDir: 'C:\\Users\\u\\AppData\\Local\\Programs\\Aura',
    ...over,
  };
  return { updater: createUpdater(deps), deps, tempDir, calls };
}

describe('createUpdater — проверка', () => {
  it('новее установленной — обновление из releases/latest репозитория Aura', async () => {
    const { updater, deps } = setup();
    const res = await updater.check(false);
    expect(res).toMatchObject({ kind: 'available', info: { version: '0.3.0', assetName: 'Aura-Setup-0.3.0.exe', sha256: SHA } });
    expect(deps.fetchJson).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.any(Number));
  });

  it('офлайн при запуске — «обновлений нет» молча; по кнопке — «нет соединения»', async () => {
    const { updater } = setup({
      fetchJson: vi.fn(async () => {
        throw new SourceError('offline');
      }),
    });
    expect(await updater.check(false)).toEqual({ kind: 'none' });
    expect(await updater.check(true)).toEqual({ kind: 'error', offline: true });
  });

  it('GitHub ответил ошибкой или релиз без .exe — молча; по кнопке ошибка сервиса — не «нет соединения»', async () => {
    const failing = setup({
      fetchJson: vi.fn(async () => {
        throw new SourceError('unavailable');
      }),
    });
    expect(await failing.updater.check(false)).toEqual({ kind: 'none' });
    expect(await failing.updater.check(true)).toEqual({ kind: 'error', offline: false });
    const noExe = setup({ fetchJson: vi.fn(async () => releaseJson({ name: 'Aura-0.3.0.zip' })) });
    expect(await noExe.updater.check(true)).toEqual({ kind: 'none' });
  });

  it('не упакованная Aura (dev) не проверяет вовсе — кроме подменённого адреса релизов', async () => {
    const dev = setup({ isPackaged: false });
    expect(await dev.updater.check(true)).toEqual({ kind: 'none' });
    expect(dev.deps.fetchJson).not.toHaveBeenCalled();
    const test = setup({ isPackaged: false, releaseUrl: 'http://127.0.0.1:4545/latest' });
    expect((await test.updater.check(false)).kind).toBe('available');
    expect(test.deps.fetchJson).toHaveBeenCalledWith('http://127.0.0.1:4545/latest', expect.any(Number));
  });

  it('установщик не по https с настоящего адреса — обновления нет', async () => {
    const { updater } = setup({ fetchJson: vi.fn(async () => releaseJson({ browser_download_url: 'http://evil.example/Aura-Setup-0.3.0.exe' })) });
    expect(await updater.check(true)).toEqual({ kind: 'none' });
  });

  it('повторный вызов во время идущей проверки ждёт тот же запрос релиза, а не шлёт второй', async () => {
    let answer: (v: unknown) => void = () => undefined;
    const fetchJson = vi.fn<() => Promise<unknown>>(() => new Promise<unknown>((resolve) => (answer = resolve)));
    const { updater } = setup({ fetchJson });
    const first = updater.check(false);
    const second = updater.check(false);
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalled());
    answer(releaseJson());
    expect((await first).kind).toBe('available');
    expect((await second).kind).toBe('available');
    expect(fetchJson).toHaveBeenCalledTimes(1);
    // Проверка кончилась — следующая снова идёт в сеть.
    fetchJson.mockImplementation(async () => releaseJson());
    await updater.check(false);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('кнопка «Проверить» во время тихой проверки при запуске получает ошибку по-своему, а запрос один', async () => {
    let fail: (e: unknown) => void = () => undefined;
    const fetchJson = vi.fn(() => new Promise<unknown>((_, reject) => (fail = reject)));
    const { updater } = setup({ fetchJson });
    const silent = updater.check(false);
    const manual = updater.check(true);
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalled());
    fail(new SourceError('offline'));
    expect(await silent).toEqual({ kind: 'none' });
    expect(await manual).toEqual({ kind: 'error', offline: true });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});

describe('createUpdater — скачивание', () => {
  it('скачивает установщик с прогрессом, сверяет размер и сумму', async () => {
    const { updater, deps, tempDir } = setup();
    await updater.check(false);
    const progress: number[] = [];
    await updater.download((p) => progress.push(p));
    expect(progress).toEqual([0, 0.5, 1]);
    expect(deps.fetchToFile).toHaveBeenCalledTimes(1);
    expect(readdirSync(tempDir)).toEqual(['Aura-Setup-0.3.0.exe']);
  });

  it('неверный размер — ошибка «файл повреждён», недокачанный файл удалён', async () => {
    const { updater, tempDir } = setup({ fetchToFile: vi.fn(writingFetch(Buffer.from('обрезано'))) });
    await updater.check(false);
    await expect(updater.download(() => undefined)).rejects.toMatchObject({ code: 'corrupt', message: expect.stringMatching(/^Не удалось скачать обновление/) });
    expect(readdirSync(tempDir)).toEqual([]);
  });

  it('не сошлась сумма SHA-256 — ошибка, файл удалён', async () => {
    const same = Buffer.alloc(BODY.length, 1);
    const { updater, tempDir } = setup({ fetchToFile: vi.fn(writingFetch(same)) });
    await updater.check(false);
    await expect(updater.download(() => undefined)).rejects.toMatchObject({ code: 'corrupt' });
    expect(readdirSync(tempDir)).toEqual([]);
  });

  it('обрыв сети — ошибка «нет соединения», частичный файл удалён', async () => {
    const { updater, tempDir } = setup({
      fetchToFile: vi.fn<FetchFile>(async (_url, dest) => {
        writeFileSync(dest, 'MZ');
        throw new SourceError('offline', 'Соединение оборвалось');
      }),
    });
    await updater.check(false);
    await expect(updater.download(() => undefined)).rejects.toMatchObject({ code: 'offline', message: expect.stringMatching(/соединени/i) });
    expect(readdirSync(tempDir)).toEqual([]);
  });

  it('повторное «Обновить» во время скачивания не качает второй раз параллельно', async () => {
    let finish: () => void = () => undefined;
    const fetchToFile = vi.fn<FetchFile>(
      (_url, dest) =>
        new Promise((resolve) => {
          finish = () => {
            writeFileSync(dest, BODY);
            resolve(dest);
          };
        }),
    );
    const { updater } = setup({ fetchToFile });
    await updater.check(false);
    const first = updater.download(() => undefined);
    const second = updater.download(() => undefined);
    await vi.waitFor(() => expect(fetchToFile).toHaveBeenCalled());
    finish();
    await Promise.all([first, second]);
    expect(fetchToFile).toHaveBeenCalledTimes(1);
  });

  it('«Отмена» — скачивание прервано, файл удалён, ошибка с кодом cancelled; потом можно скачать заново', async () => {
    const fetchToFile = vi.fn<FetchFile>(
      (_url, dest, _p, signal) =>
        new Promise((_resolve, reject) => {
          writeFileSync(dest, 'MZ');
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const { updater, tempDir, deps } = setup({ fetchToFile });
    await updater.check(false);
    const run = updater.download(() => undefined);
    await vi.waitFor(() => expect(fetchToFile).toHaveBeenCalled());
    updater.cancel();
    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    expect(readdirSync(tempDir)).toEqual([]);
    fetchToFile.mockImplementation(writingFetch());
    await updater.download(() => undefined);
    expect(deps.fetchToFile).toHaveBeenCalledTimes(2);
  });

  it('без найденного обновления скачивать нечего', async () => {
    const { updater } = setup();
    await expect(updater.download(() => undefined)).rejects.toThrow();
  });
});

describe('createUpdater — установка', () => {
  it('запускает скачанный установщик тихо поверх в папку установки и выходит обычным путём', async () => {
    const { updater, tempDir, calls } = setup();
    await updater.check(false);
    await updater.download(() => undefined);
    await updater.install();
    const installer = join(tempDir, 'Aura-Setup-0.3.0.exe');
    expect(INSTALLER_ARGS).toEqual(['/S', '--updated']);
    expect(calls).toEqual([`spawn ${installer} /S --updated /D=C:\\Users\\u\\AppData\\Local\\Programs\\Aura`, 'quit']);
  });

  it('выходит только после того, как обёртка установки запустилась; не запустилась — не выходит, ошибка', async () => {
    let started: () => void = () => undefined;
    const order: string[] = [];
    const ok = setup({
      spawn: vi.fn(() => new Promise<void>((resolve) => (started = () => { order.push('started'); resolve(); }))),
      quit: vi.fn(() => { order.push('quit'); }),
    });
    await ok.updater.check(false);
    await ok.updater.download(() => undefined);
    const run = ok.updater.install();
    await vi.waitFor(() => expect(ok.deps.spawn).toHaveBeenCalled());
    expect(order).toEqual([]);
    started();
    await run;
    expect(order).toEqual(['started', 'quit']);

    const failing = setup({ spawn: vi.fn(async () => { throw new Error('ENOENT powershell.exe'); }) });
    await failing.updater.check(false);
    await failing.updater.download(() => undefined);
    await expect(failing.updater.install()).rejects.toMatchObject({ code: 'failed', message: expect.stringMatching(/^Не удалось/) });
    expect(failing.deps.quit).not.toHaveBeenCalled();
  });

  it('не скачано — не запускает ничего', async () => {
    const { updater, deps } = setup();
    await updater.check(false);
    await expect(updater.install()).rejects.toThrow();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('скачанный файл пропал или подменён перед установкой — не запускает', async () => {
    const { updater, deps, tempDir } = setup();
    await updater.check(false);
    await updater.download(() => undefined);
    writeFileSync(join(tempDir, 'Aura-Setup-0.3.0.exe'), Buffer.alloc(BODY.length, 7));
    await expect(updater.install()).rejects.toMatchObject({ code: 'corrupt' });
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(existsSync(join(tempDir, 'Aura-Setup-0.3.0.exe'))).toBe(false);
  });

  it('при проверке убирает установщики, оставшиеся от прошлых обновлений', async () => {
    const { updater, tempDir } = setup();
    writeFileSync(join(tempDir, 'Aura-Setup-0.2.1.exe'), 'старый');
    writeFileSync(join(tempDir, 'Aura-Setup-0.3.0.exe.part'), 'обрывок');
    await updater.check(false);
    expect(readdirSync(tempDir)).toEqual([]);
  });
});

describe('installScript — обёртка установки', () => {
  it('ждёт выхода Aura, ставит с ключами одной строкой (/D= последним, без кавычек), затем открывает Aura', () => {
    const script = installScript({
      pid: 4242,
      installer: String.raw`C:\Temp\aura-update\Aura-Setup-0.3.0.exe`,
      args: ['/S', '--updated', String.raw`/D=D:\Profiles\Д'Артаньян\AppData\Local\Programs\Aura`],
      relaunch: String.raw`D:\Profiles\Д'Артаньян\AppData\Local\Programs\Aura\Aura.exe`,
      relaunchArgs: [],
    });
    const steps = script.split('\r\n').filter((l) => l && !l.startsWith('#'));
    expect(steps[0]).toMatch(/^Wait-Process -Id 4242 /);
    expect(steps[1]).toBe(
      String.raw`Start-Process -FilePath 'C:\Temp\aura-update\Aura-Setup-0.3.0.exe' -ArgumentList '/S --updated /D=D:\Profiles\Д''Артаньян\AppData\Local\Programs\Aura' -Wait -ErrorAction SilentlyContinue`,
    );
    expect(steps[2]).toBe(String.raw`Start-Process -FilePath 'D:\Profiles\Д''Артаньян\AppData\Local\Programs\Aura\Aura.exe'`);
  });

  it('ключи перезапуска (проверочный запуск не упакованной Aura) — одной строкой, с пробелами — в кавычках', () => {
    const script = installScript({ pid: 1, installer: 'a.exe', args: ['/S'], relaunch: 'electron.exe', relaunchArgs: ['.', '--user-data-dir=C:/Temp/aura test'] });
    expect(script.split('\r\n').filter((l) => l && !l.startsWith('#'))[2]).toBe(
      `Start-Process -FilePath 'electron.exe' -ArgumentList '. "--user-data-dir=C:/Temp/aura test"'`,
    );
  });
});

describe('launcherCommand — запуск обёртки', () => {
  it('скрытый PowerShell, переживающий выход Aura: Start-Process с -File скрипта (путь в кавычках, апостроф удвоен)', () => {
    expect(launcherCommand(String.raw`D:\Profiles\Д'Ар тан\Temp\aura-update\update.ps1`)).toBe(
      String.raw`Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\Profiles\Д''Ар тан\Temp\aura-update\update.ps1"'`,
    );
  });
});

describe('безопасность обновления', () => {
  it('psQuote экранирует все одинарные кавычки PowerShell: U+0027 и U+2018–U+201B', () => {
    for (const q of ["'", '\u2018', '\u2019', '\u201A', '\u201B']) {
      expect(psQuote(`a${q}b`)).toBe(`'a${q}${q}b'`);
    }
  });

  it.runIf(process.platform === 'win32')('PowerShell 5.1 читает строку psQuote буквально — внедрённая команда не выполняется', () => {
    const evil = 'Aura-Setup-\u2019; Write-Output INJECTED; \u2018x\u201A\u201B\'.exe';
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output ${psQuote(evil)}`], {
      encoding: 'utf8',
    });
    expect(out.stdout.trim()).toBe(evil);
  }, 20_000);

  it('скачанный файл лежит в tempDir под именем из версии, а не под именем ассета из ответа сервера', async () => {
    const fetchToFile = vi.fn(writingFetch());
    const { updater, tempDir } = setup({
      fetchToFile,
      fetchJson: vi.fn(async () =>
        releaseJson({
          name: 'Aura-Setup-0.3.0-x64.exe',
          browser_download_url: 'https://github.com/danilaAfanasev/Auraplayer/releases/download/v0.3.0/Aura-Setup-0.3.0-x64.exe',
        }),
      ),
    });
    await updater.check(false);
    await updater.download(() => undefined);
    const dest = fetchToFile.mock.calls[0][1];
    expect(dirname(dest)).toBe(tempDir);
    expect(readdirSync(tempDir)).toEqual(['Aura-Setup-0.3.0.exe']);
  });

  it('путь из имени ассета с «..» не принимается вовсе', async () => {
    const { updater } = setup({ fetchJson: vi.fn(async () => releaseJson({ name: 'Aura-Setup-../../../evil.exe' })) });
    expect(await updater.check(true)).toEqual({ kind: 'none' });
  });

  it('в упакованной Aura подменённый адрес релизов (AURA_UPDATE_URL) не действует', async () => {
    const { updater, deps } = setup({
      isPackaged: true,
      releaseUrl: 'http://127.0.0.1:4545/latest',
      fetchJson: vi.fn(async () => releaseJson({ browser_download_url: 'http://127.0.0.1:4545/Aura-Setup-0.3.0.exe' })),
    });
    expect(await updater.check(true)).toEqual({ kind: 'none' });
    expect(deps.fetchJson).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.any(Number));
  });
});
