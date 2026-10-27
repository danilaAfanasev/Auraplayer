import { IPC } from '../../shared/ipc';
import { normalizeLibrary } from '../../shared/library';
import type { LibraryData } from '../../shared/types';
import { readJson, writeJson } from '../store';
import { handle } from './handle';

export const LIBRARY_FILE = 'library.json';

export async function loadLibrary(): Promise<LibraryData> {
  return normalizeLibrary(await readJson<unknown>(LIBRARY_FILE, null));
}

export function registerLibraryIpc(): void {
  handle(IPC.library.load, (): Promise<LibraryData> => loadLibrary());
  handle(IPC.library.save, async (lib: LibraryData): Promise<void> => {
    await writeJson(LIBRARY_FILE, normalizeLibrary(lib));
  });
}
