// Настройки: загрузка из main, update(patch) с отложенным сохранением, применение темы.
import { flushSync } from 'react-dom';
import { create } from 'zustand';
import { defaultSettings } from '../../shared/settings';
import type { Settings, ThemeSettings } from '../../shared/types';
import { errorMessage } from '../app/errors';
import { applyPaletteVars } from '../theme/applyTheme';
import { runThemeTransition, type ThemeOrigin } from '../theme/themeTransition';
import { createDebouncedSaver } from './persist';
import { useUi } from './useUi';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<Settings>): void;
  /**
   * Меняет тему и сохраняет её. Новые цвета «заливают» окно кругом от `origin` (точка клика;
   * без неё — от центра) за ~0,7 с, при «уменьшении анимации» — кроссфейд 200 мс.
   */
  applyTheme(theme: ThemeSettings, origin?: ThemeOrigin): void;
}

const saver = createDebouncedSaver<Settings>(
  (s) => window.aura.settings.save(s),
  (err) => useUi.getState().toast(`Не удалось сохранить настройки: ${errorMessage(err)}`, undefined, 'error'),
);

/**
 * Сохранять можно только после успешной загрузки: если settings.json не прочитался (занят, нет доступа),
 * запись настроек по умолчанию затёрла бы настоящие (папки, источники, тему).
 */
let canSave = false;
const schedule = (s: Settings): void => {
  if (canSave) saver.schedule(s);
};

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings(''),
  loaded: false,

  async load() {
    try {
      const settings = await window.aura.settings.load();
      applyPaletteVars(settings.theme);
      set({ settings, loaded: true });
      canSave = true;
    } catch (err) {
      applyPaletteVars(get().settings.theme);
      set({ loaded: true });
      useUi
        .getState()
        .toast(
          `Не удалось загрузить настройки: ${errorMessage(err)}. Изменения пока не сохраняются`,
          { label: 'Повторить', run: () => void get().load() },
          'error',
        );
    }
  },

  update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (patch.theme) applyPaletteVars(settings.theme);
    schedule(settings);
  },

  applyTheme(theme, origin) {
    const next: ThemeSettings = { ...theme };
    const current = get().settings.theme;
    if (current.presetId === next.presetId && current.accent === next.accent && current.background === next.background) return;
    void runThemeTransition(() => {
      // Стор и переменные меняются в одном кадре: отметка выбранной темы и цвета появляются вместе.
      flushSync(() => {
        set((state) => ({ settings: { ...state.settings, theme: next } }));
        applyPaletteVars(next);
      });
      schedule(get().settings);
    }, origin);
  },
}));

export const flushSettings = (): Promise<void> => saver.flush();
