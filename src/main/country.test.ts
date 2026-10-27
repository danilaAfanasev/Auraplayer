import { describe, expect, it } from 'vitest';
import { currentCountry, resolveCountry, setChartCountrySetting } from './country';

describe('resolveCountry', () => {
  it('«как в системе»: код страны системы в нижнем регистре', () => {
    expect(resolveCountry('auto', 'RU')).toBe('ru');
    expect(resolveCountry('auto', 'US')).toBe('us');
    expect(resolveCountry('auto', 'de')).toBe('de');
  });

  it('страна системы, которой нет в списке, или её нет вовсе — США', () => {
    expect(resolveCountry('auto', 'JP')).toBe('us');
    expect(resolveCountry('auto', '')).toBe('us');
    expect(resolveCountry('auto', undefined)).toBe('us');
  });

  it('явный выбор пользователя побеждает систему', () => {
    expect(resolveCountry('gb', 'RU')).toBe('gb');
    expect(resolveCountry('kz', 'US')).toBe('kz');
  });

  it('мусор вместо настройки считается «как в системе»', () => {
    expect(resolveCountry('xx' as never, 'RU')).toBe('ru');
    expect(resolveCountry(undefined, 'FR')).toBe('fr');
  });
});

describe('currentCountry', () => {
  it('берёт настройку пользователя; без неё и без страны системы — США', () => {
    setChartCountrySetting('de');
    expect(currentCountry()).toBe('de');
    setChartCountrySetting('auto');
    expect(currentCountry()).toBe('us');
  });
});
