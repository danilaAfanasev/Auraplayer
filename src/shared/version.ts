// Версии Aura и разбор последнего релиза GitHub (обновление по вопросу, G46–G49): чистые функции без сети.

/** Репозиторий релизов: `github.com/<UPDATE_REPO>/releases`. */
export const UPDATE_REPO = 'danilaAfanasev/Auraplayer';
/** Открытый API GitHub (без ключа): последний опубликованный релиз — не черновик и не пререлиз. */
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
export const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPO}/releases`;
/** Файл установщика в релизе (`nsis.artifactName` в electron-builder.yml). */
// Только буквы, цифры, точка и дефис: без разделителей пути, пробелов и кавычек (имя видно в окне, а файл на диске
// всё равно называется по версии — см. updater.ts).
export const INSTALLER_ASSET = /^Aura-Setup-[0-9A-Za-z.-]+\.exe$/;
/** «Что нового» в окне обновления — не длиннее стольких строк. */
export const NOTES_MAX_LINES = 12;

export interface UpdateInfo {
  /** `X.Y.Z` без префикса `v`. */
  version: string;
  /** «Что нового» — простой текст из описания релиза. */
  notes: string;
  /** Страница релиза на GitHub. */
  pageUrl: string;
  assetUrl: string;
  assetName: string;
  /** Размер установщика в байтах — по нему проверяется скачанный файл. */
  size: number;
  /** SHA-256 установщика (hex), если GitHub отдал `digest`. */
  sha256?: string;
}

/** Итог проверки: нет новее / есть / не удалось (только при проверке кнопкой — при запуске ошибки молчат). */
export type UpdateCheck = { kind: 'none' } | { kind: 'available'; info: UpdateInfo } | { kind: 'error'; offline: boolean };

/** Код ошибки скачивания/установки обновления (`Error.code` через IPC). */
export type UpdateErrorCode = 'offline' | 'corrupt' | 'cancelled' | 'failed';

/** `'v0.2.1'` | `'0.2.1'` → `[0, 2, 1]`; иначе null (в том числе `0.3.0-beta`). */
export function parseVersion(s: string): [number, number, number] | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Сравнение `X.Y.Z` по числам; невалидная версия меньше любой валидной. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return va ? 1 : vb ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] > vb[i] ? 1 : -1;
  }
  return 0;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWebUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v);

/**
 * Ответ `releases/latest` → обновление, если релиз новее `current`. null — не новее, черновик или пререлиз,
 * нет файла `Aura-Setup-*.exe` с размером, битый ответ.
 */
export function parseLatestRelease(json: unknown, current: string): UpdateInfo | null {
  if (!isObject(json) || json.draft === true || json.prerelease === true) return null;
  if (typeof json.tag_name !== 'string') return null;
  const parsed = parseVersion(json.tag_name);
  if (!parsed || compareVersions(json.tag_name, current) <= 0) return null;
  const version = parsed.join('.');
  if (!Array.isArray(json.assets)) return null;

  const installers = json.assets.filter(
    (a): a is Record<string, unknown> & { name: string; size: number; browser_download_url: string } =>
      isObject(a) &&
      typeof a.name === 'string' &&
      INSTALLER_ASSET.test(a.name) &&
      typeof a.size === 'number' &&
      Number.isFinite(a.size) &&
      a.size > 0 &&
      isWebUrl(a.browser_download_url),
  );
  const asset = installers.find((a) => a.name === `Aura-Setup-${version}.exe`) ?? installers[0];
  if (!asset) return null;

  const info: UpdateInfo = {
    version,
    notes: typeof json.body === 'string' ? releaseNotesText(json.body) : '',
    pageUrl: isWebUrl(json.html_url) ? json.html_url : RELEASES_PAGE_URL,
    assetUrl: asset.browser_download_url,
    assetName: asset.name,
    size: asset.size,
  };
  const digest = typeof asset.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest.trim()) : null;
  if (digest) info.sha256 = digest[1].toLowerCase();
  return info;
}

/** Строка Markdown → простой текст: ссылки и выделение без разметки, пункты списка — «• ». */
function plainLine(line: string): string {
  let s = line.trim();
  s = s.replace(/^#{1,6}\s+/, ''); // заголовок
  s = s.replace(/^(>\s?)+/, ''); // цитата
  s = s.replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '• '); // пункт списка (и задачи)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // картинка
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // ссылка
  s = s.replace(/<[^>]+>/g, ''); // HTML
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2'); // жирный
  s = s.replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2'); // курсив
  s = s.replace(/`+([^`]*)`+/g, '$1'); // код
  s = s.replace(/~~(.+?)~~/g, '$1');
  return s.trim();
}

/** Описание релиза (Markdown) → «что нового»: без разметки, без подряд пустых строк, не больше `maxLines` строк. */
export function releaseNotesText(markdown: string, maxLines = NOTES_MAX_LINES): string {
  const out: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (/^(```|~~~)/.test(trimmed)) continue; // ограждение блока кода
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) continue; // горизонтальная черта
    const line = plainLine(raw);
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  if (out.length <= maxLines) return out.join('\n');
  const kept = out.slice(0, Math.max(0, maxLines - 1));
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return [...kept, '…'].join('\n');
}
