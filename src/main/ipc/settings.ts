import { IPC } from '../../shared/ipc';
import type { Settings } from '../../shared/types';
import { currentCountry } from '../country';
import { getSettings, saveSettings } from '../settingsStore';
import { chartsService } from './charts';
import { handle } from './handle';

export function registerSettingsIpc(): void {
  handle(IPC.settings.load, (): Promise<Settings> => getSettings());
  handle(IPC.settings.save, async (s: Settings): Promise<void> => {
    await getSettings();
    const before = currentCountry();
    await saveSettings(s);
    // Другая страна чарта — «Популярное сейчас» пересобирается сразу.
    if (currentCountry() !== before) void chartsService.refresh();
  });
}
