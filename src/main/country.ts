// Страна чарта «Популярное сейчас» и поиска каталога: выбор пользователя, иначе страна системы, иначе США.
// Модуль не тянет electron на старте: страна системы читается лениво (тесты подставляют её параметром).
import { CHART_COUNTRIES, type CountryCode, type Settings } from '../shared/types';

const FALLBACK: CountryCode = 'us';

const isKnown = (code: string): code is CountryCode => CHART_COUNTRIES.some((c) => c.code === code);

/** Двухбуквенный код страны системы (`app.getLocaleCountryCode()`), пустая строка — если узнать нельзя. */
export function systemCountryCode(): string {
  try {
    // require, а не import: в тестах electron не нужен; в сборке main (CommonJS) это обычный вызов.
    const { app } = require('electron') as typeof import('electron');
    return app.getLocaleCountryCode();
  } catch {
    return '';
  }
}

/** Страна для каталога: явный выбор → страна системы (если каталог её знает) → США. */
export function resolveCountry(setting: Settings['chartCountry'] | undefined, system: string | undefined = systemCountryCode()): CountryCode {
  if (setting && setting !== 'auto' && isKnown(setting)) return setting;
  const code = (system ?? '').trim().toLowerCase();
  return isKnown(code) ? code : FALLBACK;
}

let chosen: Settings['chartCountry'] = 'auto';

/** Настройка «Страна чарта» (её задаёт хранилище настроек при загрузке и сохранении). */
export function setChartCountrySetting(value: Settings['chartCountry']): void {
  chosen = value;
}

/** Страна каталога прямо сейчас — для модулей, у которых настроек под рукой нет (артисты, лента, чарт). */
export const currentCountry = (): CountryCode => resolveCountry(chosen);
