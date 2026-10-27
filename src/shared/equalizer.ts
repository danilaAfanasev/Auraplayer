// Модель эквалайзера: 10 полос, встроенные пресеты, «Свой», мои пресеты. Чистые функции без DOM:
// окошко у кнопки и раздел настроек правят одно состояние (`Settings.equalizer`) только через них,
// звуковой граф получает усиления из `effectiveGains`.

export const EQ_BANDS_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;
export const PREAMP_MIN = -12;
export const PREAMP_MAX = 6;
export const MAX_CUSTOM_PRESETS = 20;
/** Шаг усиления, дБ. */
const GAIN_STEP = 0.5;
const MAX_NAME_LENGTH = 40;

export interface EqPreset {
  id: string;
  name: string;
  gains: number[];
}

/** Подписи полос: 32 … 500, 1к … 16к. */
export const EQ_BAND_LABELS = EQ_BANDS_HZ.map((hz) => (hz >= 1000 ? `${hz / 1000}к` : String(hz)));

export const BUILTIN_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Обычный', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', name: 'Бас', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', name: 'Вокал', gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { id: 'hiphop', name: 'Хип-хоп', gains: [5, 4, 2, 3, -1, -1, 1, 0, 2, 3] },
  { id: 'electronic', name: 'Электроника', gains: [5, 4, 1, 0, -2, 1, 0, 2, 4, 5] },
  { id: 'rock', name: 'Рок', gains: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4] },
  { id: 'quiet', name: 'Тихо', gains: [-3, -2, 0, 1, 2, 2, 1, 0, -2, -4] },
];

export const CUSTOM_PRESET_ID = 'custom';
export const CUSTOM_PRESET_NAME = 'Свой';
const FLAT_ID = 'flat';

export interface EqualizerSettings {
  enabled: boolean;
  presetId: string;
  gains: number[];
  preamp: number;
  /** Только мои пресеты; встроенные — в `BUILTIN_PRESETS`. */
  presets: EqPreset[];
}

export type PresetError = 'empty' | 'duplicate' | 'limit';
export type PresetResult = { eq: EqualizerSettings } | { error: PresetError };

const zeros = (): number[] => EQ_BANDS_HZ.map(() => 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function clampStep(db: number, min: number, max: number): number {
  const stepped = Math.round(db / GAIN_STEP) * GAIN_STEP;
  return Math.min(max, Math.max(min, stepped)) + 0; // +0 — без «−0»
}

const clampGain = (db: number): number => clampStep(db, EQ_GAIN_MIN, EQ_GAIN_MAX);

export function defaultEqualizer(): EqualizerSettings {
  return { enabled: false, presetId: FLAT_ID, gains: zeros(), preamp: 0, presets: [] };
}

export function allPresets(eq: EqualizerSettings): EqPreset[] {
  return [...BUILTIN_PRESETS, ...eq.presets];
}

function findPreset(eq: EqualizerSettings, id: string): EqPreset | undefined {
  return allPresets(eq).find((p) => p.id === id);
}

export function applyPreset(eq: EqualizerSettings, presetId: string): EqualizerSettings {
  const preset = findPreset(eq, presetId);
  if (!preset) return eq;
  return { ...eq, enabled: true, presetId: preset.id, gains: [...preset.gains] };
}

export function setBandGain(eq: EqualizerSettings, index: number, db: number): EqualizerSettings {
  if (!Number.isInteger(index) || index < 0 || index >= EQ_BANDS_HZ.length || !isNumber(db)) return eq;
  const gains = [...eq.gains];
  gains[index] = clampGain(db);
  return { ...eq, enabled: true, presetId: CUSTOM_PRESET_ID, gains };
}

export function setPreamp(eq: EqualizerSettings, db: number): EqualizerSettings {
  if (!isNumber(db)) return eq;
  return { ...eq, preamp: clampStep(db, PREAMP_MIN, PREAMP_MAX) };
}

/** «Сбросить»: «Обычный», все полосы в ноль; мои пресеты и предусиление остаются. */
export function resetEqualizer(eq: EqualizerSettings): EqualizerSettings {
  return { ...eq, presetId: FLAT_ID, gains: zeros() };
}

const nameKey = (name: string): string => name.trim().toLocaleLowerCase('ru');

function checkName(eq: EqualizerSettings, name: string, exceptId?: string): PresetError | null {
  const key = nameKey(name);
  if (!key) return 'empty';
  if (key === nameKey(CUSTOM_PRESET_NAME)) return 'duplicate';
  if (allPresets(eq).some((p) => p.id !== exceptId && nameKey(p.name) === key)) return 'duplicate';
  return null;
}

const cleanName = (name: string): string => name.trim().slice(0, MAX_NAME_LENGTH);

function newPresetId(eq: EqualizerSettings): string {
  const taken = new Set(allPresets(eq).map((p) => p.id));
  let n = eq.presets.length + 1;
  while (taken.has(`my${n}`)) n++;
  return `my${n}`;
}

/** Текущие полосы — новым моим пресетом (он же становится выбранным). */
export function savePreset(eq: EqualizerSettings, name: string): PresetResult {
  const error = checkName(eq, cleanName(name));
  if (error) return { error };
  if (eq.presets.length >= MAX_CUSTOM_PRESETS) return { error: 'limit' };
  const preset: EqPreset = { id: newPresetId(eq), name: cleanName(name), gains: [...eq.gains] };
  return { eq: { ...eq, presetId: preset.id, presets: [...eq.presets, preset] } };
}

export function renamePreset(eq: EqualizerSettings, id: string, name: string): PresetResult {
  if (!eq.presets.some((p) => p.id === id)) return { eq };
  const error = checkName(eq, cleanName(name), id);
  if (error) return { error };
  return { eq: { ...eq, presets: eq.presets.map((p) => (p.id === id ? { ...p, name: cleanName(name) } : p)) } };
}

/** Удаляет мой пресет; был выбран — звук остаётся как был, выбор становится «Свой». */
export function deletePreset(eq: EqualizerSettings, id: string): EqualizerSettings {
  if (!eq.presets.some((p) => p.id === id)) return eq;
  return {
    ...eq,
    presetId: eq.presetId === id ? CUSTOM_PRESET_ID : eq.presetId,
    presets: eq.presets.filter((p) => p.id !== id),
  };
}

/** «Вернуть» после удаления: пресет на прежнее место (если имя и id ещё свободны и есть место). */
export function restorePreset(eq: EqualizerSettings, preset: EqPreset, index: number): EqualizerSettings {
  if (eq.presets.length >= MAX_CUSTOM_PRESETS || findPreset(eq, preset.id) || checkName(eq, preset.name)) return eq;
  const presets = [...eq.presets];
  presets.splice(Math.max(0, Math.min(index, presets.length)), 0, preset);
  return { ...eq, presets };
}

/** Имя по умолчанию для «Сохранить как пресет»: первое свободное «Мой пресет N». */
export function nextPresetName(eq: EqualizerSettings): string {
  for (let n = 1; ; n++) {
    const name = `Мой пресет ${n}`;
    if (!checkName(eq, name)) return name;
  }
}

/** «Бас» | «Свой» | имя моего. */
export function presetLabel(eq: EqualizerSettings): string {
  return findPreset(eq, eq.presetId)?.name ?? CUSTOM_PRESET_NAME;
}

/** Что идёт в звуковой граф: выключенный эквалайзер — все нули (звук как без него). */
export function effectiveGains(eq: EqualizerSettings): { preamp: number; gains: number[] } {
  if (!eq.enabled) return { preamp: 0, gains: zeros() };
  return { preamp: eq.preamp, gains: [...eq.gains] };
}

function normalizeGains(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== EQ_BANDS_HZ.length || !raw.every(isNumber)) return null;
  return raw.map(clampGain);
}

function normalizePresets(raw: unknown): EqPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: EqPreset[] = [];
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_PRESETS) break;
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string') continue;
    const gains = normalizeGains(item.gains);
    const name = cleanName(item.name);
    if (!gains || item.id === CUSTOM_PRESET_ID) continue;
    const draft: EqualizerSettings = { ...defaultEqualizer(), presets: out };
    if (findPreset(draft, item.id) || checkName(draft, name)) continue;
    out.push({ id: item.id, name, gains });
  }
  return out;
}

export function normalizeEqualizer(raw: unknown): EqualizerSettings {
  const d = defaultEqualizer();
  if (!isRecord(raw)) return d;
  const presets = normalizePresets(raw.presets);
  const eq: EqualizerSettings = {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    presetId: d.presetId,
    gains: normalizeGains(raw.gains) ?? d.gains,
    preamp: isNumber(raw.preamp) ? clampStep(raw.preamp, PREAMP_MIN, PREAMP_MAX) : d.preamp,
    presets,
  };
  const id = typeof raw.presetId === 'string' ? raw.presetId : d.presetId;
  eq.presetId = id === CUSTOM_PRESET_ID || findPreset(eq, id) ? id : CUSTOM_PRESET_ID;
  return eq;
}
