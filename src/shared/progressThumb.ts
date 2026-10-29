// Значок на полосе трека: встроенные и нарисованные пользователем (сетка 24×24). Без electron и DOM.

export const BUILTIN_THUMB_IDS = [
  'dot',
  'six-seven',
  'crosshair',
  'vinyl',
  'note',
  'flame',
  'bolt',
  'heart',
  'skull',
  'star',
  'ghost',
  'paw',
  'rocket',
  'cassette',
  'diamond',
  'aura',
] as const;
export type BuiltinThumbId = (typeof BUILTIN_THUMB_IDS)[number];

/** Встроенные значки по порядку в сетке настроек; первый — обычный кружок, он по умолчанию. */
export const BUILTIN_THUMBS: { id: BuiltinThumbId; name: string }[] = [
  { id: 'dot', name: 'Кружок' },
  { id: 'six-seven', name: '«67»' },
  { id: 'crosshair', name: 'Прицел' },
  { id: 'vinyl', name: 'Пластинка' },
  { id: 'note', name: 'Нота' },
  { id: 'flame', name: 'Огонёк' },
  { id: 'bolt', name: 'Молния' },
  { id: 'heart', name: 'Сердце' },
  { id: 'skull', name: 'Череп' },
  { id: 'star', name: 'Звезда' },
  { id: 'ghost', name: 'Призрак' },
  { id: 'paw', name: 'Кошачья лапка' },
  { id: 'rocket', name: 'Ракета' },
  { id: 'cassette', name: 'Кассета' },
  { id: 'diamond', name: 'Алмаз' },
  { id: 'aura', name: 'Aura' },
];

export type ThumbChoice = { kind: 'builtin'; id: BuiltinThumbId } | { kind: 'custom'; id: string };

export interface CustomThumb {
  id: string;
  name: string;
  /** До 16 цветов `#rrggbb`. */
  palette: string[];
  /** 576 символов, по строкам: `.` — прозрачно, `0`…`f` — номер цвета палитры. */
  pixels: string;
}

export const THUMB_GRID = 24;
export const MAX_CUSTOM_THUMBS = 12;
export const MAX_THUMB_COLORS = 16;
export const MAX_THUMB_NAME = 24;
/** Размер значка на полосе, px: встроенный (векторный) и нарисованный (одна клетка — один пиксель экрана). */
export const BUILTIN_THUMB_SIZE = 22;
export const CUSTOM_THUMB_SIZE = THUMB_GRID;

const CELLS = THUMB_GRID * THUMB_GRID;
const CLEAR = '.';
const COLOR_CHARS = '0123456789abcdef';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_THUMB_CHOICE: ThumbChoice = { kind: 'builtin', id: 'dot' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Выбор значка из настроек: неизвестный встроенный и удалённый свой — кружок. */
export function normalizeThumbChoice(raw: unknown, customs: readonly CustomThumb[]): ThumbChoice {
  if (!isObject(raw) || typeof raw.id !== 'string') return DEFAULT_THUMB_CHOICE;
  if (raw.kind === 'builtin') {
    const id = BUILTIN_THUMB_IDS.find((b) => b === raw.id);
    return id ? { kind: 'builtin', id } : DEFAULT_THUMB_CHOICE;
  }
  if (raw.kind === 'custom') {
    const id = raw.id;
    return customs.some((c) => c.id === id) ? { kind: 'custom', id } : DEFAULT_THUMB_CHOICE;
  }
  return DEFAULT_THUMB_CHOICE;
}

export function emptyPixels(): string {
  return CLEAR.repeat(CELLS);
}

/** Рисунок без единой закрашенной клетки. */
export function isEmptyThumb(t: { pixels: string }): boolean {
  return !/[^.]/.test(t.pixels);
}

/** Клетка `index` (по строкам, 0…575) — цвета `color` (символ палитры или `.` — стереть). */
export function setPixel(pixels: string, index: number, color: string): string {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS || pixels[index] === color) return pixels;
  return pixels.slice(0, index) + color + pixels.slice(index + 1);
}

/** Заливка: связная (по сторонам, не по диагонали) область того же цвета, что клетка `index`, получает `color`. */
export function floodFill(pixels: string, index: number, color: string): string {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return pixels;
  const target = pixels[index];
  if (target === color) return pixels;
  const cells = pixels.split('');
  const stack = [index];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (cells[i] !== target) continue;
    cells[i] = color;
    const x = i % THUMB_GRID;
    if (x > 0) stack.push(i - 1);
    if (x < THUMB_GRID - 1) stack.push(i + 1);
    if (i >= THUMB_GRID) stack.push(i - THUMB_GRID);
    if (i < CELLS - THUMB_GRID) stack.push(i + THUMB_GRID);
  }
  return cells.join('');
}

function normalizeCustomThumb(raw: unknown): CustomThumb | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '' || typeof raw.name !== 'string') return null;
  if (!Array.isArray(raw.palette) || raw.palette.length === 0 || raw.palette.length > MAX_THUMB_COLORS) return null;
  if (!raw.palette.every((c) => typeof c === 'string' && HEX_COLOR.test(c))) return null;
  const palette = (raw.palette as string[]).map((c) => c.toLowerCase());
  const pixels = raw.pixels;
  if (typeof pixels !== 'string' || pixels.length !== CELLS) return null;
  for (const ch of pixels) {
    if (ch === CLEAR) continue;
    const at = COLOR_CHARS.indexOf(ch);
    if (at < 0 || at >= palette.length) return null;
  }
  if (isEmptyThumb({ pixels })) return null;
  const name = raw.name.trim().slice(0, MAX_THUMB_NAME).trim() || 'Мой значок';
  return { id: raw.id, name, palette, pixels };
}

/** Свои значки из настроек: битые и пустые отбрасываются, повторный id — тоже, больше 12 не бывает. */
export function normalizeCustomThumbs(raw: unknown): CustomThumb[] {
  if (!Array.isArray(raw)) return [];
  const result: CustomThumb[] = [];
  for (const item of raw) {
    const thumb = normalizeCustomThumb(item);
    if (!thumb || result.some((t) => t.id === thumb.id)) continue;
    result.push(thumb);
    if (result.length === MAX_CUSTOM_THUMBS) break;
  }
  return result;
}

/** Картинка нарисованного значка: прямоугольник на каждый ряд подряд идущих клеток одного цвета. */
export function customThumbSvg(thumb: Pick<CustomThumb, 'palette' | 'pixels'>): string {
  const rects: string[] = [];
  for (let y = 0; y < THUMB_GRID; y++) {
    let x = 0;
    while (x < THUMB_GRID) {
      const ch = thumb.pixels[y * THUMB_GRID + x];
      const color = ch === CLEAR ? undefined : thumb.palette[COLOR_CHARS.indexOf(ch)];
      let end = x + 1;
      while (end < THUMB_GRID && thumb.pixels[y * THUMB_GRID + end] === ch) end++;
      if (color) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color}"/>`);
      x = end;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${THUMB_GRID} ${THUMB_GRID}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

// Контуры встроенных значков — иконки lucide (лицензия ISC, https://lucide.dev), кроме «67», пластинки (дуги сдвинуты,
// чтобы вращение было видно) и логотипа Aura (знак из `AuraLogo`). Чёрное — это маска: цвет значку задаёт тема.
const F = ' fill="#000"';
const BUILTIN_ART: Record<Exclude<BuiltinThumbId, 'dot'>, string> = {
  'six-seven':
    '<g stroke-width="2.6"><path d="M10.5 3.5C6 5.5 3 10 3 16"/><circle cx="7" cy="16" r="4"/><path d="M13.5 4h8L16 21"/></g>',
  crosshair:
    '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/><circle cx="12" cy="12" r="1.3" fill="#000"/>',
  vinyl:
    '<circle cx="12" cy="12" r="10"/><path d="M5.5 12a6.5 6.5 0 0 1 2.3-5"/><path d="M18.5 12a6.5 6.5 0 0 1-2.3 5"/><circle cx="12" cy="12" r="2.2" fill="#000"/>',
  note: `<path d="M21 16V3a1 1 0 0 0-1.28-.96l-10 2.917a1 1 0 0 0-.72.96V19"/><circle cx="18" cy="16" r="3"${F}/><circle cx="6" cy="19" r="3"${F}/>`,
  flame: `<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"${F}/>`,
  bolt: `<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"${F}/>`,
  heart: `<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"${F}/>`,
  skull:
    '<path d="m12.5 17-.5-1-.5 1h1z"/><path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><circle cx="15" cy="12" r="1.4" fill="#000"/><circle cx="9" cy="12" r="1.4" fill="#000"/>',
  star: `<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"${F}/>`,
  ghost:
    '<path d="M15 10v1.5M9 10v1.5"/><path d="M7.528 20.472a1.6 1.6 0 012.277 0l1.057 1.056a1.6 1.6 0 002.276 0l1.057-1.056a1.6 1.6 0 012.277 0l1.114 1.114a1.4 1.4 0 002.414-1V10a8 8 0 00-16 0v10.586a1.4 1.4 0 002.414 1z"/>',
  paw: `<circle cx="11" cy="4" r="2"${F}/><circle cx="18" cy="8" r="2"${F}/><circle cx="20" cy="16" r="2"${F}/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"${F}/>`,
  rocket:
    '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
  cassette:
    '<rect width="20" height="16" x="2" y="4" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M8 12h8"/><circle cx="16" cy="10" r="2"/><path d="m6 20 .7-2.9A1.4 1.4 0 0 1 8.1 16h7.8a1.4 1.4 0 0 1 1.4 1l.7 3"/>',
  diamond: `<path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"${F}/>`,
  aura: `<circle cx="12" cy="12" r="9.2" stroke-width="1.9"/><g${F} stroke="none"><rect x="7.7" y="10.3" width="1.5" height="3.4" rx=".75"/><rect x="9.9" y="8.4" width="1.5" height="7.2" rx=".75"/><rect x="12.2" y="7.5" width="1.5" height="9" rx=".75"/><rect x="14.4" y="9.5" width="1.5" height="5" rx=".75"/></g>`,
};

function builtinThumbSvg(id: Exclude<BuiltinThumbId, 'dot'>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BUILTIN_ART[id]}</svg>`;
}

/** Как рисовать значок на ползунке. */
export interface ThumbArt {
  /** `mask` — одноцветная маска, цвет даёт тема; `image` — картинка со своими цветами. */
  mode: 'mask' | 'image';
  svg: string;
  /** Сторона значка на полосе, px. */
  size: number;
  /** Крутится, пока играет трек (пластинка). */
  spin: boolean;
}

/** Рисунок значка для полосы; `null` — обычный кружок (его рисует стиль ползунка), и для удалённого своего значка. */
export function thumbArt(choice: ThumbChoice, customs: readonly CustomThumb[]): ThumbArt | null {
  if (choice.kind === 'builtin') {
    if (choice.id === 'dot') return null;
    return { mode: 'mask', svg: builtinThumbSvg(choice.id), size: BUILTIN_THUMB_SIZE, spin: choice.id === 'vinyl' };
  }
  const thumb = customs.find((c) => c.id === choice.id);
  return thumb ? { mode: 'image', svg: customThumbSvg(thumb), size: CUSTOM_THUMB_SIZE, spin: false } : null;
}

/** Оставляет в палитре только цвета, которые есть на рисунке (не больше 16 в записи), и пересчитывает номера в сетке. */
export function compactThumb(palette: readonly string[], pixels: string): { palette: string[]; pixels: string } {
  const remap = new Map<string, string>();
  const kept: string[] = [];
  let out = '';
  for (const ch of pixels) {
    if (ch === CLEAR) {
      out += CLEAR;
      continue;
    }
    let next = remap.get(ch);
    if (next === undefined) {
      next = COLOR_CHARS[kept.length];
      remap.set(ch, next);
      kept.push(palette[COLOR_CHARS.indexOf(ch)]);
    }
    out += next;
  }
  return { palette: kept, pixels: out };
}
