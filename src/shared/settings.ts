// Настройки по умолчанию и проверка настроек, прочитанных с диска.
import { defaultEqualizer, normalizeEqualizer } from './equalizer';
import { DEFAULT_THEME, parseHex, toHex } from './palette';
import { DEFAULT_THUMB_CHOICE, normalizeCustomThumbs, normalizeThumbChoice } from './progressThumb';
import { CHART_COUNTRIES, SOUNDWAVE_STYLES, type RepeatMode, type Settings, type SoundwaveStyle, type ThemeSettings } from './types';

export const DEFAULT_VOLUME = 0.8;

export function defaultSettings(downloadDir: string): Settings {
  return {
    version: 1,
    theme: { ...DEFAULT_THEME },
    downloadDir,
    youtubeEnabled: true,
    soundcloudEnabled: true,
    waveAfterQueue: true,
    localFolders: [],
    volume: DEFAULT_VOLUME,
    muted: false,
    repeat: 'off',
    shuffle: false,
    lastSession: null,
    chartCountry: 'auto',
    onboarded: false,
    equalizer: defaultEqualizer(),
    soundwave: true,
    soundwaveStyle: 'waves',
    progressThumb: { ...DEFAULT_THUMB_CHOICE },
    customThumbs: [],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const REPEAT_MODES: RepeatMode[] = ['off', 'all', 'one'];

function normalizeCountry(raw: unknown): Settings['chartCountry'] {
  return CHART_COUNTRIES.some((c) => c.code === raw) ? (raw as Settings['chartCountry']) : 'auto';
}

function normalizeTheme(raw: unknown): ThemeSettings {
  if (!isObject(raw) || !isString(raw.accent) || !isString(raw.background)) return { ...DEFAULT_THEME };
  const accent = parseHex(raw.accent);
  const background = parseHex(raw.background);
  if (!accent || !background) return { ...DEFAULT_THEME };
  const presetId = isString(raw.presetId) ? raw.presetId : null;
  return { presetId, accent: toHex(accent), background: toHex(background) };
}

function normalizeSession(raw: unknown): Settings['lastSession'] {
  if (!isObject(raw) || !Array.isArray(raw.queue) || !isNumber(raw.index) || !isNumber(raw.positionSec)) return null;
  const queue = raw.queue.filter(isString);
  if (queue.length === 0) return null;
  const index = Math.min(Math.max(0, Math.floor(raw.index)), queue.length - 1);
  return { queue, index, positionSec: Math.max(0, raw.positionSec) };
}

/**
 * Приводит прочитанный JSON к `Settings`: неверные поля заменяются значениями по умолчанию,
 * лишние (например, `jamendoClientId` прошлых версий) отбрасываются.
 */
export function normalizeSettings(raw: unknown, downloadDir: string): Settings {
  const d = defaultSettings(downloadDir);
  if (!isObject(raw)) return d;
  const customThumbs = normalizeCustomThumbs(raw.customThumbs);
  return {
    version: 1,
    theme: normalizeTheme(raw.theme),
    downloadDir: isString(raw.downloadDir) && raw.downloadDir.trim() ? raw.downloadDir : d.downloadDir,
    youtubeEnabled: typeof raw.youtubeEnabled === 'boolean' ? raw.youtubeEnabled : d.youtubeEnabled,
    soundcloudEnabled: typeof raw.soundcloudEnabled === 'boolean' ? raw.soundcloudEnabled : d.soundcloudEnabled,
    waveAfterQueue: typeof raw.waveAfterQueue === 'boolean' ? raw.waveAfterQueue : d.waveAfterQueue,
    localFolders: Array.isArray(raw.localFolders) ? [...new Set(raw.localFolders.filter(isString))] : d.localFolders,
    volume: isNumber(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : d.volume,
    muted: typeof raw.muted === 'boolean' ? raw.muted : d.muted,
    repeat: REPEAT_MODES.includes(raw.repeat as RepeatMode) ? (raw.repeat as RepeatMode) : d.repeat,
    shuffle: typeof raw.shuffle === 'boolean' ? raw.shuffle : d.shuffle,
    lastSession: normalizeSession(raw.lastSession),
    chartCountry: normalizeCountry(raw.chartCountry),
    // Файл настроек уже есть, а поля нет — пользователь старой версии: первый запуск ему не показываем.
    onboarded: typeof raw.onboarded === 'boolean' ? raw.onboarded : true,
    equalizer: normalizeEqualizer(raw.equalizer),
    // Саундвейв включён по умолчанию — и у старого файла без поля.
    soundwave: typeof raw.soundwave === 'boolean' ? raw.soundwave : d.soundwave,
    // Вид волны: у старого файла без поля и при чужом значении — «Волны», как было до выбора видов.
    soundwaveStyle: SOUNDWAVE_STYLES.includes(raw.soundwaveStyle as SoundwaveStyle) ? (raw.soundwaveStyle as SoundwaveStyle) : d.soundwaveStyle,
    // Значок полосы: нет поля, чужое значение или выбран удалённый свой — кружок.
    progressThumb: normalizeThumbChoice(raw.progressThumb, customThumbs),
    customThumbs,
  };
}
