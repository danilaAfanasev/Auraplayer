// Чистая копия Aura для публикации: `npm run public` [-- --out <папка>] [-- --author "Имя <почта>"].
//
// Берёт только отслеживаемые файлы рабочего репозитория (`git ls-files`: новый файл, которого нет в git,
// в копию не попадёт), кроме служебных (EXCLUDED), проверяет их на личное и кладёт в отдельную папку
// (по умолчанию ../aura-public) со своим git: `git init` при первом запуске, затем `git add -A` и один коммит
// «Aura <версия>». Повторный запуск синхронизирует копию (удалённые здесь файлы удаляются и там) и делает
// следующий коммит. Если автор (из git-конфига или `--author`) не совпадает с авторами коммитов копии, история
// копии пересоздаётся одним коммитом — иначе прежняя почта осталась бы в старых коммитах; у копии с `remote`
// (её, возможно, уже отправили) скрипт вместо этого останавливается с объяснением.
//
// Личное ищется по списку из файла `.public-forbidden` в корне репозитория (он в .gitignore и в копию
// не попадает — иначе сам список выдал бы, что прячем), плюс имя пользователя системы, домашняя папка
// и почта из git-конфига. Нашлось — ошибка со списком «файл:строка», копия не трогается.
// Адрес IP в подписанных ссылках видео в образцах ответов (`.json`, их пишет yt-dlp) заменяется на 0.0.0.0.
//
// Скрипт ничего не публикует: никаких `git remote`, `push`, создания репозиториев — это делает человек сам.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Что не идёт в копию: служебное рабочего репозитория (переписка сборки, правила агентов, ADR с цитатами, выпуск версии). */
export const EXCLUDED = ['.autopilot/', 'AGENTS.md', 'CLAUDE.md', 'RELEASING.md', 'docs/adr/'];

/** Папки копии, которые синхронизация не трогает: свой git и то, что человек собрал в копии. */
export const KEEP_IN_COPY = ['.git/', 'node_modules/', 'out/', 'release/'];

export const FORBIDDEN_FILE = '.public-forbidden';
const MIN_FORBIDDEN_LENGTH = 3;

/** IPv4 или IPv6 (в том числе с %3A вместо двоеточия, как в адресах googlevideo). */
const ADDR = String.raw`(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{1,4}(?:(?::|%3A)[0-9a-f]{0,4}){2,7})`;
const NOT_ZERO = String.raw`(?!0\.0\.0\.0(?![\d.]))`;
const IP_PATH = new RegExp(String.raw`(/ip/)${ADDR}(?=[/"'&?\s]|$)`, 'gi');
const IP_QUERY = new RegExp(String.raw`([?&]ip=)${ADDR}(?![0-9a-f.:%])`, 'gi');
const IP_IN_URL = [
  new RegExp(String.raw`/ip/${NOT_ZERO}${ADDR}(?=[/"'&?\s]|$)`, 'i'),
  new RegExp(String.raw`[?&]ip=${NOT_ZERO}${ADDR}(?![0-9a-f.:%])`, 'i'),
];

export function isExcluded(path) {
  return EXCLUDED.some((rule) => (rule.endsWith('/') ? path.startsWith(rule) : path === rule));
}

/** Список запрещённых строк: из файла списка (строка — запись, `#` — комментарий) и из окружения. */
export function forbiddenList({ listText = '', username = '', homedir = '', email = '' }) {
  const fromFile = listText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const local = email.includes('@') ? email.slice(0, email.indexOf('@')) : '';
  const fromEnv = [username, homedir, homedir.replaceAll('\\', '/'), email, local];
  const all = [...fromFile, ...fromEnv].filter((s) => s.length >= MIN_FORBIDDEN_LENGTH);
  return [...new Set(all)];
}

/** Находки личного: `{path, line, match}` для каждой строки из списка (без учёта регистра) и адреса IP в ссылках. */
export function findForbidden(files, forbidden) {
  const needles = forbidden.map((s) => ({ match: s, lower: s.toLowerCase() }));
  const found = [];
  for (const { path, text } of files) {
    const lines = text.split('\n');
    lines.forEach((raw, i) => {
      const lower = raw.toLowerCase();
      for (const n of needles) if (lower.includes(n.lower)) found.push({ path, line: i + 1, match: n.match });
      for (const re of IP_IN_URL) {
        const m = raw.match(re);
        if (m) found.push({ path, line: i + 1, match: `адрес IP в ссылке (${m[0]})` });
      }
    });
  }
  return found;
}

/** Адрес IP в подписанных ссылках (`/ip/<адрес>/`, `?ip=<адрес>`) → 0.0.0.0. */
export function redact(text) {
  return text.replace(IP_PATH, '$10.0.0.0').replace(IP_QUERY, '$10.0.0.0');
}

/** Адреса убираются только из образцов ответов (`.json`): код и тексты с адресом не правятся молча — их ловит проверка. */
export function redactFile(path, text) {
  return path.endsWith('.json') ? redact(text) : text;
}

export function parseArgs(argv) {
  const opts = { out: '../aura-public', author: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (key !== '--out' && key !== '--author') throw new Error(`Неизвестный ключ ${arg}. Можно: --out <папка>, --author "Имя <почта>"`);
    const value = inline ?? argv[++i];
    if (!value) throw new Error(`После ${key} нужно значение`);
    opts[key.slice(2)] = value;
  }
  return opts;
}

export function parseAuthor(text) {
  const m = /^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(text);
  if (!m) throw new Error(`Автор должен быть вида "Имя <почта>", а не «${text}»`);
  return { name: m[1], email: m[2] };
}

/** Файлы копии, которых больше нет в новом наборе (кроме KEEP_IN_COPY). */
export function staleFiles(existing, next) {
  const keep = new Set(next);
  return existing.filter((p) => !keep.has(p) && !KEEP_IN_COPY.some((dir) => p.startsWith(dir)));
}

// ——— дальше — работа с диском и git ———

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitConfig(cwd, key) {
  try {
    return git(cwd, ['config', key]).trim();
  } catch {
    return '';
  }
}

function sourceFiles(root) {
  // Только то, что в git: черновик или чужой файл в рабочем дереве не должен уехать в публичную копию.
  const listed = git(root, ['ls-files', '-z', '--cached']).split('\0').filter(Boolean);
  return [...new Set(listed)].filter((p) => !isExcluded(p) && existsSync(join(root, p)) && statSync(join(root, p)).isFile()).sort();
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full).split(sep).join('/');
    if (entry.isDirectory()) {
      if (KEEP_IN_COPY.includes(`${rel}/`)) continue;
      walk(full, base, out);
    } else out.push(rel);
  }
  return out;
}

async function removeEmptyDirs(dir, isRoot = true) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (isRoot && KEEP_IN_COPY.includes(`${entry.name}/`)) continue;
    await removeEmptyDirs(join(dir, entry.name), false);
  }
  if (!isRoot && readdirSync(dir).length === 0) await rmdir(dir);
}

/** Удалить папку целиком: `unlink` (а не fs.rmSync — на Windows + Node 24 он молча пропускает не-ASCII имена). */
async function removeTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await removeTree(full);
    else {
      await chmod(full, 0o666); // объекты git только для чтения — без этого unlink на Windows падает
      await unlink(full);
    }
  }
  await rmdir(dir);
}

const person = (p) => `${p.name} <${p.email}>`;

/** Авторы и коммитеры всех коммитов копии («Имя <почта>»); коммитов ещё нет — пусто. */
function historyPeople(target) {
  try {
    return [...new Set(git(target, ['log', '--all', '--format=%an <%ae>%n%cn <%ce>']).split('\n').filter(Boolean))];
  } catch {
    return [];
  }
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function makePublic({ root, out, author }) {
  const target = resolve(root, out);
  if (isInside(target, root) || isInside(root, target)) {
    throw new Error(`Папка копии ${target} не может быть внутри рабочего репозитория или содержать его`);
  }

  const files = sourceFiles(root);
  const contents = new Map();
  for (const path of files) {
    const buf = readFileSync(join(root, path));
    contents.set(path, isBinary(buf) ? buf : Buffer.from(redactFile(path, buf.toString('utf8')), 'utf8'));
  }

  const listPath = join(root, FORBIDDEN_FILE);
  const forbidden = forbiddenList({
    listText: existsSync(listPath) ? readFileSync(listPath, 'utf8') : '',
    username: os.userInfo().username,
    homedir: os.homedir(),
    email: gitConfig(root, 'user.email'),
  });
  const found = findForbidden(
    [...contents].map(([path, buf]) => ({ path, text: buf.toString('utf8') })),
    forbidden,
  );
  if (found.length) {
    const list = found.map((f) => `  ${f.path}:${f.line} — «${f.match}»`).join('\n');
    throw new Error(`В копии нашлось личное (${found.length}), копия не тронута:\n${list}`);
  }

  const who = author ? parseAuthor(author) : { name: gitConfig(root, 'user.name'), email: gitConfig(root, 'user.email') };
  if (!who.name || !who.email) throw new Error('Не знаю автора коммита: задай git config user.name/user.email или --author "Имя <почта>"');

  const isNew = !existsSync(target);
  if (!isNew && !existsSync(join(target, '.git')) && readdirSync(target).length > 0) {
    throw new Error(`Папка ${target} уже есть, не пустая и это не копия Aura (нет .git) — выбери другую через --out`);
  }
  await mkdir(target, { recursive: true });

  // Другой автор — прежняя почта не должна остаться в старых коммитах: история пересоздаётся.
  let rewritten = false;
  if (existsSync(join(target, '.git'))) {
    const others = historyPeople(target).filter((p) => p !== person(who));
    if (others.length > 0) {
      const remotes = git(target, ['remote']).trim();
      if (remotes) {
        throw new Error(
          `В истории копии другой автор (${others.join(', ')}), а у неё есть remote (${remotes.split('\n').join(', ')}): ` +
            'историю, которую, возможно, уже отправили, скрипт пересоздавать не будет — копия не тронута. ' +
            'Убери remote (git remote remove <имя>) или удали папку .git копии и запусти снова.',
        );
      }
      await removeTree(join(target, '.git'));
      rewritten = true;
    }
  }

  const stale = staleFiles(walk(target), files);
  for (const path of stale) await unlink(join(target, path));
  let written = 0;
  for (const [path, buf] of contents) {
    const dest = join(target, path);
    if (existsSync(dest) && (await readFile(dest)).equals(buf)) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    written++;
  }
  await removeEmptyDirs(target);

  if (!existsSync(join(target, '.git'))) git(target, ['init', '-q', '-b', 'main']);
  git(target, ['add', '-A']);
  const version = JSON.parse(contents.get('package.json').toString('utf8')).version;
  const changed = git(target, ['status', '--porcelain']).trim() !== '';
  if (changed) {
    const env = {
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: who.email,
    };
    git(target, ['commit', '-q', '-m', `Aura ${version}`], env);
  }
  const commits = Number(git(target, ['rev-list', '--count', 'HEAD']).trim());
  const remotes = git(target, ['remote']).trim();
  return { target, files: files.length, written, removed: stale.length, committed: changed, commits, version, author: who, remotes, rewritten };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const opts = parseArgs(process.argv.slice(2));
  const r = await makePublic({ root, ...opts });
  console.log(`Копия: ${r.target}`);
  if (r.rewritten) console.log('В истории копии был другой автор — история пересоздана одним коммитом');
  console.log(`Файлов: ${r.files} (записано ${r.written}, удалено ${r.removed})`);
  console.log(r.committed ? `Коммит «Aura ${r.version}» от ${r.author.name} <${r.author.email}>, всего коммитов: ${r.commits}` : 'Изменений нет — новый коммит не нужен');
  if (r.remotes) console.log(`Внимание: у копии есть remote (${r.remotes.split('\n').join(', ')}) — скрипт его не создавал и ничего не отправлял`);
  if (!opts.author) {
    console.log('Почта автора взята из git config. Перед публикацией можно взять адрес GitHub вида <id>+<логин>@users.noreply.github.com: --author "Имя <почта>"');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
