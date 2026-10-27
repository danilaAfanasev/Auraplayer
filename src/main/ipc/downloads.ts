// Скачивание: IPC над очередью загрузок (`src/main/downloads.ts`).
// События прогресса уходят во все окна по каналу IPC.downloads.state (DownloadState).
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc';
import { isRetiredTrack } from '../../shared/library';
import { makeTrackId, SOURCE_IDS, type SourceId, type Track } from '../../shared/types';
import { createDownloadManager, DOWNLOADS_FILE, type DownloadEntry } from '../downloads';
import type { MediaRoots } from '../protocol';
import { getSettings } from '../settingsStore';
import { getAdapter, setDownloadedLookup } from '../sources';
import { COVERS_DIR } from '../sources/local';
import { readJson, writeJson } from '../store';
import { assertString, handle, UserError } from './handle';
import { RETIRED_SOURCE_MESSAGE } from './sources';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** Трек из рендерера: только известные поля, id согласован с источником. */
function cleanTrack(raw: unknown): Track {
  const t = raw as Partial<Track> | null;
  if (!t || typeof t !== 'object') throw new UserError('Неверный трек');
  const source = t.source as SourceId;
  // Трек убранного источника (Jamendo) из лайков или плейлиста: скачанный раньше файл уже в «Скачанном».
  if (typeof source === 'string' && source && typeof t.id === 'string' && (!SOURCE_IDS.includes(source) || isRetiredTrack({ id: t.id }))) {
    throw new UserError(RETIRED_SOURCE_MESSAGE);
  }
  if (!SOURCE_IDS.includes(source) || typeof t.sourceId !== 'string' || !t.sourceId) throw new UserError('Неверный трек');
  if (t.id !== makeTrackId(source, t.sourceId)) throw new UserError('Неверный трек');
  const track: Track = {
    id: t.id,
    source,
    sourceId: t.sourceId,
    title: str(t.title) ?? 'Без названия',
    artist: str(t.artist) ?? 'Неизвестный исполнитель',
    downloadable: t.downloadable === true,
  };
  if (str(t.album)) track.album = t.album;
  if (typeof t.durationSec === 'number' && Number.isFinite(t.durationSec)) track.durationSec = t.durationSec;
  if (str(t.coverUrl)) track.coverUrl = t.coverUrl;
  if (str(t.pageUrl)) track.pageUrl = t.pageUrl;
  if (Array.isArray(t.tags)) track.tags = t.tags.filter((x): x is string => typeof x === 'string').slice(0, 20);
  return track;
}

const manager = createDownloadManager({
  context: async () => ({ settings: await getSettings(), userDataDir: app.getPath('userData') }),
  downloaderFor: (track) => {
    const adapter = getAdapter(track.source);
    return adapter.download?.bind(adapter);
  },
  readRecords: () => readJson<unknown>(DOWNLOADS_FILE, null),
  writeRecords: (records) => writeJson(DOWNLOADS_FILE, { version: 1, records }),
  emit: (state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.downloads.state, state);
    }
  },
});

// Скачанная копия играет вместо потока (и без сети).
setDownloadedLookup((trackId) => manager.findFile(trackId));

/** Что разрешено отдавать протоколу aura-media: папка скачивания, «Мои файлы», кэш обложек, файлы записей загрузок. */
export async function mediaRoots(): Promise<MediaRoots> {
  const settings = await getSettings();
  return {
    dirs: [settings.downloadDir, ...settings.localFolders, join(app.getPath('userData'), COVERS_DIR)],
    files: await manager.recordedFiles().catch(() => []),
  };
}

/** Перед выходом: отменить все загрузки и дождаться уборки частичных файлов (не дольше ~3 с). */
export function cancelAllDownloads(): Promise<void> {
  return manager.cancelAll();
}

/** При старте: убрать обрывки прошлых загрузок из папки скачивания. */
export function sweepDownloadLeftovers(): Promise<void> {
  return manager.sweepLeftovers().catch((err: unknown) => console.error('[downloads] уборка обрывков:', err));
}

/** Пути, которые «Показать в папке» может открыть: папка скачивания, «Мои файлы», файлы записей загрузок. */
export async function showableRoots(): Promise<MediaRoots> {
  const settings = await getSettings();
  return {
    dirs: [settings.downloadDir, ...settings.localFolders],
    files: await manager.recordedFiles().catch(() => []),
  };
}

export function registerDownloadsIpc(): void {
  handle(IPC.downloads.start, async (track: Track): Promise<void> => {
    await manager.start(cleanTrack(track)).catch((err: unknown) => {
      throw new UserError(err instanceof Error && err.message ? err.message : 'Не удалось скачать трек');
    });
  });
  handle(IPC.downloads.cancel, async (trackId: string): Promise<void> => {
    assertString(trackId, 'trackId');
    await manager.cancel(trackId);
  });
  handle(IPC.downloads.list, (): Promise<DownloadEntry[]> => manager.list());
  handle(IPC.downloads.remove, async (trackId: string): Promise<void> => {
    assertString(trackId, 'trackId');
    await manager.remove(trackId).catch((err: unknown) => {
      throw new UserError(err instanceof Error && err.message ? err.message : 'Не удалось удалить файл');
    });
  });
}
