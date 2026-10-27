// «Популярное сейчас» и лента артистов: IPC над сервисом чартов (`src/main/charts.ts`).
// Обновление стартует при запуске приложения и повторяется каждые 6 часов; снимки уходят во все окна
// по каналам IPC.charts.update (ChartsSnapshot) и IPC.artists.feedUpdate (ArtistFeedSnapshot).
import { BrowserWindow } from 'electron';
import type { ArtistFeedSnapshot, ChartsSnapshot } from '../../shared/api';
import { IPC } from '../../shared/ipc';
import { ARTIST_FEED_FILE, CHARTS_FILE, createChartsService } from '../charts';
import { currentCountry } from '../country';
import { getSettings } from '../settingsStore';
import { artists } from '../sources/artists';
import { fetchCatalog } from '../sources/catalog';
import { readJson, writeJson } from '../store';
import { handle } from './handle';
import { loadLibrary } from './library';

function broadcast(channel: string, snapshot: ChartsSnapshot | ArtistFeedSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, snapshot);
  }
}

export const chartsService = createChartsService({
  load: async () => {
    await getSettings(); // страна чарта — из настроек
    return fetchCatalog({ country: currentCountry() });
  },
  // Сменили страну, пока шло обновление (settings.save зовёт refresh) — следом обновление для новой.
  country: currentCountry,
  read: () => readJson<unknown>(CHARTS_FILE, null),
  write: (data) => writeJson(CHARTS_FILE, data),
  emit: (s) => broadcast(IPC.charts.update, s),
  feed: {
    // Подписки — из library.json: рендерер дописывает его перед «Обновить» после подписки.
    load: async (onFollowed) => {
      await getSettings();
      return artists.buildFeed((await loadLibrary()).followedArtists, onFollowed);
    },
    read: () => readJson<unknown>(ARTIST_FEED_FILE, null),
    write: (data) => writeJson(ARTIST_FEED_FILE, data),
    emit: (s) => broadcast(IPC.artists.feedUpdate, s),
  },
});

export function registerChartsIpc(): void {
  handle(IPC.charts.get, (): Promise<ChartsSnapshot> => chartsService.snapshot());
  handle(IPC.charts.refresh, (): Promise<ChartsSnapshot> => chartsService.refresh());
  chartsService.start();
}
