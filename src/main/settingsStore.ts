// Настройки в main: чтение/запись settings.json и кэш для других модулей main
// (источники, загрузки берут папку скачивания, переключатели источников и т. п. отсюда).
import { app } from 'electron';
import { join } from 'node:path';
import { normalizeSettings } from '../shared/settings';
import type { Settings } from '../shared/types';
import { setChartCountrySetting } from './country';
import { readJson, writeJson } from './store';

export const SETTINGS_FILE = 'settings.json';

let cached: Settings | null = null;

export function defaultDownloadDir(): string {
  return join(app.getPath('music'), 'Aura');
}

export async function getSettings(): Promise<Settings> {
  if (!cached) {
    cached = normalizeSettings(await readJson<unknown>(SETTINGS_FILE, null), defaultDownloadDir());
    setChartCountrySetting(cached.chartCountry);
  }
  return cached;
}

export async function saveSettings(next: unknown): Promise<Settings> {
  const clean = normalizeSettings(next, defaultDownloadDir());
  cached = clean;
  setChartCountrySetting(clean.chartCountry);
  await writeJson(SETTINGS_FILE, clean);
  return clean;
}
