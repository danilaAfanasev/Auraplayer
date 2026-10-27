import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findForbidden, forbiddenList, isExcluded, makePublic, parseArgs, parseAuthor, redact, redactFile, staleFiles } from './make-public.mjs';

// Адреса собираются из частей, чтобы исходник теста сам не выглядел как ссылка с адресом IP.
const IP4 = ['5', '6', '7', '8'].join('.');
const IP4B = ['10', '1', '2', '3'].join('.');
const IP6 = ['2a00', '1450', '4010'].join('%3A');

// Строки здесь выдуманные: настоящий список личного живёт вне git (`.public-forbidden`), и тест
// не должен сам попасть в находки, когда копия проверяется.

describe('isExcluded — что не идёт в публичную копию', () => {
  it('служебные папки и файлы рабочего репозитория', () => {
    expect(isExcluded('.autopilot/state.js')).toBe(true);
    expect(isExcluded('.autopilot/2026/tickets/19.md')).toBe(true);
    expect(isExcluded('AGENTS.md')).toBe(true);
    expect(isExcluded('CLAUDE.md')).toBe(true);
    expect(isExcluded('docs/adr/0001-track-sources.md')).toBe(true);
  });

  it('код, документы и сам скрипт остаются', () => {
    expect(isExcluded('src/main/index.ts')).toBe(false);
    expect(isExcluded('docs/architecture.md')).toBe(false);
    expect(isExcluded('docs/screenshots/home.png')).toBe(false);
    expect(isExcluded('CONTEXT.md')).toBe(false);
    expect(isExcluded('scripts/make-public.mjs')).toBe(false);
    expect(isExcluded('src/docs/adr.ts')).toBe(false);
  });
});

describe('forbiddenList — откуда берётся список личного', () => {
  it('строки файла без комментариев и пустых + имя пользователя системы, домашняя папка и почта из git', () => {
    const list = forbiddenList({
      listText: '# личное\nSecret Tool\n\n  nick-name  \n',
      username: 'jdoe',
      homedir: 'C:\\Users\\jdoe',
      email: 'john.doe77@example.com',
    });
    expect(list).toEqual(
      expect.arrayContaining(['Secret Tool', 'nick-name', 'jdoe', 'C:\\Users\\jdoe', 'C:/Users/jdoe', 'john.doe77@example.com', 'john.doe77']),
    );
    expect(list).not.toContain('# личное');
    expect(list).not.toContain('');
  });

  it('слишком короткие и общие значения не берёт (иначе находки на каждом шагу)', () => {
    const list = forbiddenList({ listText: 'ab\n', username: 'u', homedir: '', email: 'x@y.z' });
    expect(list).not.toContain('ab');
    expect(list).not.toContain('u');
    expect(list).not.toContain('x');
  });
});

describe('findForbidden — личное в копии', () => {
  const list = ['Secret Tool', 'nick-name', 'Path\\'];

  it('находит каждую строку из списка с файлом и номером строки', () => {
    const found = findForbidden(
      [
        { path: 'src/a.ts', text: 'const a = 1;\n// пускает Secret Tool\n' },
        { path: 'README.md', text: 'всё чисто' },
        { path: 'x.json', text: '{"dir": "D:/Path\\nick-name"}' },
      ],
      list,
    );
    expect(found.map((f) => `${f.path}:${f.line}`)).toEqual(['src/a.ts:2', 'x.json:1', 'x.json:1']);
    expect(found[0].match).toBe('Secret Tool');
  });

  it('без учёта регистра', () => {
    expect(findForbidden([{ path: 'a', text: 'SECRET TOOL' }], list)).toHaveLength(1);
  });

  it('адрес IP в подписанной ссылке видео — личное, даже без списка', () => {
    const found = findForbidden([{ path: 'f.json', text: `"url": "https://r1.googlevideo.com/videoplayback/ip/${IP4}/id/1"` }], []);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(1);
  });
});

describe('redact — адрес IP из образцов ответов', () => {
  it('заменяет адрес в /ip/<адрес>/ и ?ip=<адрес> на 0.0.0.0', () => {
    const text = `a/ip/${IP4}/id/x b?expire=1&ip=${IP6}/&c=1 d&ip=${IP4B}&e=1`;
    expect(redact(text)).toBe('a/ip/0.0.0.0/id/x b?expire=1&ip=0.0.0.0/&c=1 d&ip=0.0.0.0&e=1');
    expect(findForbidden([{ path: 'f', text: redact(text) }], [])).toEqual([]);
  });

  it('меняет только образцы ответов (.json): код с адресом не правится молча, а попадает в находки', () => {
    const text = `{"url": "https://r1.googlevideo.com/videoplayback/ip/${IP4}/id/1"}`;
    expect(redactFile('src/__fixtures__/video.json', text)).toBe(redact(text));
    expect(redactFile('src/__fixtures__/video.json', text)).not.toContain(IP4);
    expect(redactFile('src/main/x.ts', text)).toBe(text);
  });

  it('обычный текст не меняет', () => {
    const text = 'const tip = 1; // skip=2&zip=3 /api/ip-check/';
    expect(redact(text)).toBe(text);
  });
});

describe('parseArgs и parseAuthor', () => {
  it('папка по умолчанию — ../aura-public рядом с репозиторием', () => {
    expect(parseArgs([])).toEqual({ out: '../aura-public', author: undefined });
  });

  it('--out и --author', () => {
    expect(parseArgs(['--out', 'C:/tmp/copy', '--author', 'Имя <a@b.c>'])).toEqual({ out: 'C:/tmp/copy', author: 'Имя <a@b.c>' });
    expect(parseArgs(['--out=D:/x'])).toEqual({ out: 'D:/x', author: undefined });
  });

  it('неизвестный ключ — ошибка', () => {
    expect(() => parseArgs(['--push'])).toThrow(/--push/);
  });

  it('автор «Имя <почта>»', () => {
    expect(parseAuthor('Ivan Petrov <123+ivan@users.noreply.github.com>')).toEqual({
      name: 'Ivan Petrov',
      email: '123+ivan@users.noreply.github.com',
    });
    expect(() => parseAuthor('просто имя')).toThrow();
  });
});

describe('staleFiles — что удалить из копии при повторном запуске', () => {
  it('файлы, которых больше нет в рабочем репозитории; .git и сборка не трогаются', () => {
    const existing = ['README.md', 'src/old.ts', 'src/kept.ts', '.git/HEAD', 'node_modules/x/index.js', 'out/main/index.js', 'release/Aura.exe'];
    expect(staleFiles(existing, ['README.md', 'src/kept.ts'])).toEqual(['src/old.ts']);
  });
});

// ——— копия целиком: временный репозиторий и папка копии вне него ———

const temps = [];
const tempDir = () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'aura-public-test-'));
  temps.push(dir);
  return dir;
};
const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Рабочий репозиторий с одним коммитом; автор коммитов по умолчанию — из его git-конфига. */
function workRepo() {
  const root = tempDir();
  run(root, 'init', '-q', '-b', 'main');
  run(root, 'config', 'user.name', 'First Author');
  run(root, 'config', 'user.email', 'first.author@example.com');
  writeFileSync(join(root, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  writeFileSync(join(root, 'tracked.txt'), 'код\n');
  run(root, 'add', '-A');
  run(root, 'commit', '-q', '-m', 'init');
  return root;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe('makePublic — что попадает в копию', () => {
  it('неотслеживаемый файл рабочего дерева (не в git, не в .gitignore) в копию не попадает', async () => {
    const root = workRepo();
    writeFileSync(join(root, 'draft-notes.txt'), 'черновик, ещё не в git\n');
    const out = join(tempDir(), 'copy');
    await makePublic({ root, out });
    expect(existsSync(join(out, 'tracked.txt'))).toBe(true);
    expect(existsSync(join(out, 'draft-notes.txt'))).toBe(false);
  }, 30_000);
});

describe('makePublic — автор коммитов копии', () => {
  const people = (out) => run(out, 'log', '--all', '--format=%an <%ae>%n%cn <%ce>').split('\n');

  it('--author, отличный от автора коммитов копии, пересоздаёт историю: в ней один коммит и нет прежней почты', async () => {
    const root = workRepo();
    const out = join(tempDir(), 'copy');
    await makePublic({ root, out });
    expect(people(out)).toEqual(['First Author <first.author@example.com>', 'First Author <first.author@example.com>']);

    const r = await makePublic({ root, out, author: 'Second <1+second@users.noreply.github.com>' });
    expect(r.commits).toBe(1);
    expect(new Set(people(out))).toEqual(new Set(['Second <1+second@users.noreply.github.com>']));
    expect(run(out, 'log', '--all', '--reflog', '--format=%ae %ce')).not.toContain('first.author@example.com');
    expect(existsSync(join(out, 'tracked.txt'))).toBe(true);
  }, 30_000);

  it('тот же автор — повторный запуск добавляет следующий коммит к истории', async () => {
    const root = workRepo();
    const out = join(tempDir(), 'copy');
    await makePublic({ root, out });
    writeFileSync(join(root, 'tracked.txt'), 'код 2\n');
    run(root, 'commit', '-q', '-am', 'next');
    const r = await makePublic({ root, out });
    expect(r.commits).toBe(2);
  }, 30_000);

  it('другой автор, а у копии есть remote — останавливается с объяснением, история не тронута', async () => {
    const root = workRepo();
    const out = join(tempDir(), 'copy');
    await makePublic({ root, out });
    run(out, 'remote', 'add', 'origin', 'https://example.com/aura.git');
    await expect(makePublic({ root, out, author: 'Second <second@example.com>' })).rejects.toThrow(/remote/);
    expect(people(out)).toEqual(['First Author <first.author@example.com>', 'First Author <first.author@example.com>']);
  }, 30_000);
});
