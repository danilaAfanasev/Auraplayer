import { describe, expect, it } from 'vitest';
import { defaultEqualizer, savePreset, setBandGain } from './equalizer';
import { defaultSettings, normalizeSettings } from './settings';

const DIR = 'C:\\Users\\me\\Music\\Aura';

describe('defaultSettings', () => {
  it('первый запуск: тема «Аметист», YouTube и SoundCloud включены', () => {
    const s = defaultSettings(DIR);
    expect(s.version).toBe(1);
    expect(s.theme.presetId).toBe('amethyst');
    expect(s.theme.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(s.downloadDir).toBe(DIR);
    expect(s.youtubeEnabled).toBe(true);
    expect(s.soundcloudEnabled).toBe(true);
    expect(s.localFolders).toEqual([]);
    expect(s.volume).toBeGreaterThan(0);
    expect(s.volume).toBeLessThanOrEqual(1);
    expect(s.muted).toBe(false);
    expect(s.repeat).toBe('off');
    expect(s.shuffle).toBe(false);
    expect(s.lastSession).toBeNull();
  });
});

describe('normalizeSettings', () => {
  it('мусор → настройки по умолчанию', () => {
    expect(normalizeSettings(null, DIR)).toEqual(defaultSettings(DIR));
    expect(normalizeSettings([1, 2], DIR)).toEqual(defaultSettings(DIR));
  });
  it('сохранённые значения сохраняются, недостающие дополняются', () => {
    const s = normalizeSettings(
      { version: 1, volume: 0.3, repeat: 'one', jamendoClientId: 'abc', theme: { presetId: null, accent: '#112233', background: '#ffffff' } },
      DIR,
    );
    expect(s.volume).toBe(0.3);
    expect(s.repeat).toBe('one');
    expect(s.theme).toEqual({ presetId: null, accent: '#112233', background: '#ffffff' });
    expect(s.downloadDir).toBe(DIR);
    expect(s.youtubeEnabled).toBe(true);
  });
  it('старые настройки с ключом Jamendo читаются без ошибок, ключ отбрасывается', () => {
    const s = normalizeSettings({ version: 1, jamendoClientId: 'старый-ключ', youtubeEnabled: false, volume: 0.5 }, DIR);
    expect(s).not.toHaveProperty('jamendoClientId');
    expect(s.youtubeEnabled).toBe(false);
    expect(s.soundcloudEnabled).toBe(true);
    expect(s.volume).toBe(0.5);
  });
  it('выключенный SoundCloud остаётся выключенным', () => {
    expect(normalizeSettings({ soundcloudEnabled: false }, DIR).soundcloudEnabled).toBe(false);
    expect(normalizeSettings({ soundcloudEnabled: 'нет' }, DIR).soundcloudEnabled).toBe(true);
  });
  it('неверные значения заменяются безопасными', () => {
    const s = normalizeSettings(
      {
        volume: 7,
        repeat: 'sometimes',
        theme: { presetId: 'amethyst', accent: 'red', background: 5 },
        localFolders: ['D:\\Music', 3, 'D:\\Music'],
        downloadDir: '',
        lastSession: { queue: ['a:1'], index: 'x', positionSec: 2 },
      },
      DIR,
    );
    expect(s.volume).toBe(1);
    expect(s.repeat).toBe('off');
    expect(s.theme).toEqual(defaultSettings(DIR).theme);
    expect(s.localFolders).toEqual(['D:\\Music']);
    expect(s.downloadDir).toBe(DIR);
    expect(s.lastSession).toBeNull();
  });
  it('«Похожие после конца списка»: по умолчанию включено, выключенное остаётся выключенным', () => {
    expect(defaultSettings(DIR).waveAfterQueue).toBe(true);
    expect(normalizeSettings({}, DIR).waveAfterQueue).toBe(true);
    expect(normalizeSettings({ waveAfterQueue: false }, DIR).waveAfterQueue).toBe(false);
    expect(normalizeSettings({ waveAfterQueue: 'нет' }, DIR).waveAfterQueue).toBe(true);
  });
  it('первый запуск: новый пользователь его видит, существующий файл без поля — уже пройден', () => {
    expect(defaultSettings(DIR).onboarded).toBe(false);
    expect(normalizeSettings(null, DIR).onboarded).toBe(false);
    expect(normalizeSettings({ version: 1, volume: 0.5 }, DIR).onboarded).toBe(true);
    expect(normalizeSettings({ onboarded: false }, DIR).onboarded).toBe(false);
    expect(normalizeSettings({ onboarded: 'да' }, DIR).onboarded).toBe(true);
  });
  it('страна чарта: по умолчанию «как в системе», неизвестная — тоже', () => {
    expect(defaultSettings(DIR).chartCountry).toBe('auto');
    expect(normalizeSettings({}, DIR).chartCountry).toBe('auto');
    expect(normalizeSettings({ chartCountry: 'de' }, DIR).chartCountry).toBe('de');
    expect(normalizeSettings({ chartCountry: 'zz' }, DIR).chartCountry).toBe('auto');
    expect(normalizeSettings({ chartCountry: 5 }, DIR).chartCountry).toBe('auto');
  });
  it('последняя сессия читается', () => {
    const s = normalizeSettings({ lastSession: { queue: ['archive:1', 'local:C:\\a.mp3'], index: 1, positionSec: 42.5 } }, DIR);
    expect(s.lastSession).toEqual({ queue: ['archive:1', 'local:C:\\a.mp3'], index: 1, positionSec: 42.5 });
  });

  it('эквалайзер и саундвейв: старый файл без полей — эквалайзер выключен, саундвейв включён', () => {
    const s = normalizeSettings({ version: 1, volume: 0.5 }, DIR);
    expect(s.equalizer).toEqual(defaultEqualizer());
    expect(s.equalizer.enabled).toBe(false);
    expect(s.soundwave).toBe(true);
    expect(defaultSettings(DIR).soundwave).toBe(true);
    expect(defaultSettings(DIR).equalizer.enabled).toBe(false);
  });
  it('эквалайзер и выключенный саундвейв переживают перезапуск', () => {
    const r = savePreset(setBandGain(defaultEqualizer(), 0, 6), 'Мой');
    if ('error' in r) throw new Error(r.error);
    const saved = { ...defaultSettings(DIR), equalizer: r.eq, soundwave: false };
    const s = normalizeSettings(JSON.parse(JSON.stringify(saved)), DIR);
    expect(s.equalizer).toEqual(r.eq);
    expect(s.soundwave).toBe(false);
    expect(normalizeSettings({ soundwave: 'нет', equalizer: 5 }, DIR)).toMatchObject({ soundwave: true, equalizer: defaultEqualizer() });
  });
});
