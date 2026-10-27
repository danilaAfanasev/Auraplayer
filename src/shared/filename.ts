// Имена скачанных файлов: «Исполнитель — Название.ext», безопасные для Windows.

const MAX_BASE_LENGTH = 180;
const INVALID_CHARS = /[<>:"/\\|?*]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function cleanPart(value: string): string {
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(INVALID_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimEnd(value: string): string {
  // Windows не допускает точку или пробел в конце имени.
  return value.replace(/[. ]+$/, '');
}

/** `safeFileName('AC/DC', 'Back', 'mp3')` → `AC_DC — Back.mp3`. */
export function safeFileName(artist: string, title: string, ext: string): string {
  const cleanArtist = trimEnd(cleanPart(artist));
  const cleanTitle = trimEnd(cleanPart(title)) || 'Без названия';
  let base = cleanArtist ? `${cleanArtist} — ${cleanTitle}` : cleanTitle;
  if (base.length > MAX_BASE_LENGTH) base = trimEnd(base.slice(0, MAX_BASE_LENGTH));
  if (RESERVED_NAMES.test(base)) base = `_${base}`;
  const cleanExt = cleanPart(ext).replace(/^\.+/, '').toLowerCase();
  return cleanExt ? `${base}.${cleanExt}` : base;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith('\\') || dir.endsWith('/') ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** Первый свободный путь: `name.ext`, затем `name (2).ext`, `name (3).ext`… */
export async function uniquePath(
  dir: string,
  name: string,
  exists: (path: string) => boolean | Promise<boolean>,
): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 10_000; n++) {
    const candidate = joinPath(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Не удалось подобрать свободное имя файла');
}
