// «Мои файлы»: выбор папки, пересканирование и список треков (`src/main/sources/local.ts`).
// Папки хранятся в настройках (localFolders); убрать папку из списка — только настройка, файлы не трогаются.
import { app, BrowserWindow, dialog } from 'electron';
import { IPC } from '../../shared/ipc';
import type { Track } from '../../shared/types';
import { getSettings } from '../settingsStore';
import { localLibrary, type LocalTrack } from '../sources/local';
import type { SourceContext } from '../sources/types';
import { handle } from './handle';

export async function pickDirectory(title: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

async function context(): Promise<SourceContext> {
  return { settings: await getSettings(), userDataDir: app.getPath('userData') };
}

export function registerLocalIpc(): void {
  handle(IPC.local.pickFolder, (): Promise<string | null> => pickDirectory('Папка с музыкой'));
  handle(IPC.local.rescan, async (): Promise<Track[]> => localLibrary.rescan(await context()));
  handle(IPC.local.tracks, async (): Promise<LocalTrack[]> => localLibrary.tracks(await context()));
}
