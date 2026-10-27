// Системные действия: выбор папки скачивания, открытие ссылок и папок.
import { shell } from 'electron';
import { isAbsolute, relative, resolve } from 'node:path';
import { IPC } from '../../shared/ipc';
import type { MediaRoots } from '../protocol';
import { showableRoots } from './downloads';
import { assertString, handle, UserError } from './handle';
import { pickDirectory } from './local';

export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

const WIN_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/**
 * Обычный абсолютный путь (как в protocol.ts): на Windows — только «X:\…», без UNC `\\server`
 * (Проводник пошёл бы на чужой SMB-сервер и отдал NTLM-хеш), устройств `\\?\`, `\\.\` и потоков `file:stream`.
 */
function isPlainAbsolute(p: string): boolean {
  if (process.platform === 'win32') return WIN_DRIVE_PATH.test(p) && !p.slice(2).includes(':');
  return isAbsolute(p) && !p.startsWith('//');
}

/** `target` — сама папка `root` или лежит внутри неё (сравнение — после нормализации `..`). */
function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel));
}

/** Можно ли показать путь в Проводнике: папка скачивания или «Мои файлы» (и всё внутри), файл записи загрузки. */
export function isShowablePath(path: string, roots: MediaRoots): boolean {
  if (!path || path.includes('\0') || !isPlainAbsolute(path)) return false;
  const target = resolve(path);
  const dirs = roots.dirs.filter(isPlainAbsolute).map((d) => resolve(d));
  const files = (roots.files ?? []).filter(isPlainAbsolute).map((f) => resolve(f));
  return dirs.some((d) => isWithin(d, target)) || files.some((f) => relative(f, target) === '');
}

export function registerSystemIpc(): void {
  handle(IPC.system.pickDownloadDir, (): Promise<string | null> => pickDirectory('Папка для скачанной музыки'));

  handle(IPC.system.openExternal, async (url: string): Promise<void> => {
    assertString(url, 'url');
    if (!isSafeExternalUrl(url)) throw new UserError('Открывать можно только веб-ссылки');
    await shell.openExternal(url);
  });

  handle(IPC.system.showInFolder, async (path: string): Promise<void> => {
    assertString(path, 'path');
    if (!isShowablePath(path, await showableRoots())) throw new UserError('Эту папку открыть нельзя');
    shell.showItemInFolder(path);
  });
}
