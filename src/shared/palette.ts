// Тема Aura: все цвета интерфейса вычисляются из двух — акцента и фона.
// Единственное место в проекте, где допустимы «сырые» цвета.
import type { ThemeSettings } from './types';

export interface ThemePreset {
  id: string;
  name: string;
  accent: string;
  background: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'amethyst', name: 'Аметист', accent: '#7c4dff', background: '#1a1033' },
  { id: 'ocean', name: 'Океан', accent: '#2ec5e6', background: '#0a1a2c' },
  { id: 'emerald', name: 'Изумруд', accent: '#34d399', background: '#0b1f1a' },
  { id: 'sunset', name: 'Закат', accent: '#ff7a4d', background: '#25121a' },
  { id: 'rose', name: 'Роза', accent: '#ff5c93', background: '#220f1d' },
  { id: 'graphite', name: 'Графит', accent: '#f5c542', background: '#141417' },
  { id: 'daylight', name: 'Светлая', accent: '#6d4aff', background: '#f3f0fa' },
];

const DEFAULT_PRESET = THEME_PRESETS[0];

export const DEFAULT_THEME: ThemeSettings = {
  presetId: DEFAULT_PRESET.id,
  accent: DEFAULT_PRESET.accent,
  background: DEFAULT_PRESET.background,
};

// ---------- работа с цветом ----------

export type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const MIN_TEXT_CONTRAST = 4.5;

export function parseHex(color: string): RGB | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isHexColor(color: string): boolean {
  return parseHex(color) !== null;
}

export function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Линейное смешение: t = 0 → a, t = 1 → b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Полупрозрачный цвет `top` с непрозрачностью `alpha` поверх `bottom`. */
function over(top: RGB, alpha: number, bottom: RGB): RGB {
  return mix(bottom, top, alpha);
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function minContrast(color: RGB, backgrounds: RGB[]): number {
  return Math.min(...backgrounds.map((b) => contrastRatio(color, b)));
}

/** Сдвигает `color` к `target`, пока контраст со всеми фонами не станет ≥ min. */
function ensureContrast(color: RGB, target: RGB, backgrounds: RGB[], min: number): RGB {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const candidate = mix(color, target, Math.min(1, t));
    if (minContrast(candidate, backgrounds) >= min) return candidate;
  }
  return target;
}

/** Самый «приглушённый» вариант `text` (ближе к `toward`), который ещё читается на всех фонах. */
function mutedVariant(text: RGB, toward: RGB, backgrounds: RGB[], maxT: number, min: number): RGB {
  for (let t = maxT; t > 0; t -= 0.02) {
    const candidate = mix(text, toward, t);
    if (minContrast(candidate, backgrounds) >= min) return candidate;
  }
  return text;
}

const rgba = ([r, g, b]: RGB, a: number): string =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
const rgbList = ([r, g, b]: RGB): string => `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;

// Прозрачности слоёв интерфейса. Текст лежит на стеклянной карточке (`--card`) поверх подложки,
// иногда — с наложением `--surface*` или `--accent-soft` (ховер, выделенная строка).
const CARD_ALPHA = 0.74;
const SURFACE_ALPHA = 0.05;
const SURFACE_2_ALPHA = 0.09;
const SURFACE_HOVER_ALPHA = 0.13;
const ACCENT_SOFT_ALPHA = 0.2;

/**
 * Палитра CSS-переменных (имя → значение) из акцента и фона.
 * Гарантирует контраст ≥ 4.5:1 для `--text`, `--text-muted`, `--accent-text`, `--danger`, `--success`
 * на всех слоях интерфейса и для `--accent-contrast` на `--accent`.
 */
export function buildPalette(accent: string, background: string): Record<string, string> {
  const accentRgb = parseHex(accent);
  const bgRgb = parseHex(background);
  if (!accentRgb || !bgRgb) return buildPalette(DEFAULT_THEME.accent, DEFAULT_THEME.background);

  // Светлый текст на тёмном фоне или тёмный на светлом — что контрастнее с фоном.
  const dark = contrastRatio(WHITE, bgRgb) >= contrastRatio(BLACK, bgRgb);
  const fg: RGB = dark ? WHITE : BLACK; // цвет наложений-поверхностей
  const away: RGB = dark ? BLACK : WHITE; // куда уводим карточку, чтобы текст читался

  const bgGlow = mix(bgRgb, accentRgb, dark ? 0.42 : 0.28);
  const bgDeep = mix(bgRgb, dark ? BLACK : accentRgb, dark ? 0.35 : 0.12);

  const textStart = mix(fg, accentRgb, 0.05);

  let cardBase: RGB = bgRgb;
  let backgrounds: RGB[] = [];
  let text: RGB = fg;
  // Подбираем основу карточки: начинаем почти с цвета фона и уводим к чёрному/белому, пока текст не станет читаемым.
  for (let k = dark ? 0.25 : 0.55; k <= 1.0001; k += 0.05) {
    cardBase = mix(bgRgb, away, Math.min(1, k));
    backgrounds = [];
    for (const backdrop of [bgRgb, bgGlow, bgDeep]) {
      const card = over(cardBase, CARD_ALPHA, backdrop);
      backgrounds.push(
        card,
        over(fg, SURFACE_ALPHA, card),
        over(fg, SURFACE_2_ALPHA, card),
        over(fg, SURFACE_HOVER_ALPHA, card),
        over(accentRgb, ACCENT_SOFT_ALPHA, card),
        over(fg, SURFACE_HOVER_ALPHA, over(accentRgb, ACCENT_SOFT_ALPHA, card)),
      );
    }
    text = ensureContrast(textStart, fg, backgrounds, MIN_TEXT_CONTRAST + 0.6);
    if (minContrast(text, backgrounds) >= MIN_TEXT_CONTRAST + 0.6) break;
  }

  const popover = over(cardBase, CARD_ALPHA, bgRgb);
  backgrounds.push(popover);

  const textMuted = mutedVariant(text, popover, backgrounds, 0.5, MIN_TEXT_CONTRAST + 0.05);
  const textFaint = mutedVariant(text, popover, backgrounds, 0.7, 3);
  const accentText = ensureContrast(accentRgb, text, backgrounds, MIN_TEXT_CONTRAST + 0.05);
  const danger = ensureContrast(dark ? [255, 107, 107] : [198, 40, 40], text, backgrounds, MIN_TEXT_CONTRAST + 0.05);
  const success = ensureContrast(dark ? [74, 222, 128] : [21, 128, 61], text, backgrounds, MIN_TEXT_CONTRAST + 0.05);

  // Текст на акцентной заливке: белый или почти чёрный — что контрастнее (на крайний случай — чистый чёрный).
  const nearBlack: RGB = [16, 12, 24];
  let accentContrast: RGB = contrastRatio(WHITE, accentRgb) >= contrastRatio(nearBlack, accentRgb) ? WHITE : nearBlack;
  if (contrastRatio(accentContrast, accentRgb) < MIN_TEXT_CONTRAST) accentContrast = BLACK;
  // Ховер акцентной кнопки уводим от цвета её текста — контраст только растёт.
  const accentHover = mix(accentRgb, accentContrast === WHITE ? BLACK : WHITE, 0.12);

  const shadowBase = mix(bgRgb, BLACK, 0.85);

  return {
    '--color-scheme': dark ? 'dark' : 'light',
    '--bg': toHex(bgRgb),
    '--bg-glow': toHex(bgGlow),
    '--bg-deep': toHex(bgDeep),
    '--card': rgba(cardBase, CARD_ALPHA),
    '--popover': toHex(popover),
    '--surface': rgba(fg, SURFACE_ALPHA),
    '--surface-2': rgba(fg, SURFACE_2_ALPHA),
    '--surface-hover': rgba(fg, SURFACE_HOVER_ALPHA),
    '--border': rgba(fg, dark ? 0.08 : 0.1),
    '--border-strong': rgba(fg, dark ? 0.16 : 0.18),
    '--fg-rgb': rgbList(fg),
    '--text': toHex(text),
    '--text-muted': toHex(textMuted),
    '--text-faint': toHex(textFaint),
    '--accent': toHex(accentRgb),
    '--accent-rgb': rgbList(accentRgb),
    '--accent-hover': toHex(accentHover),
    '--accent-contrast': toHex(accentContrast),
    '--accent-soft': rgba(accentRgb, ACCENT_SOFT_ALPHA),
    '--accent-glow': rgba(accentRgb, 0.45),
    '--accent-text': toHex(accentText),
    '--danger': toHex(danger),
    '--success': toHex(success),
    '--play-bg': toHex(text),
    '--play-icon': toHex(popover),
    '--scrollbar': rgba(fg, dark ? 0.16 : 0.2),
    '--scrollbar-hover': rgba(fg, dark ? 0.3 : 0.34),
    '--shadow': rgba(shadowBase, dark ? 0.45 : 0.18),
    '--overlay': rgba(shadowBase, dark ? 0.55 : 0.3),
  };
}
