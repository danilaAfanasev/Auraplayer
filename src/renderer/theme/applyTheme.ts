// Применение темы: CSS-переменные из buildPalette на :root.
import { buildPalette } from '../../shared/palette';
import type { ThemeSettings } from '../../shared/types';

/** «r, g, b» из «rgba(r, g, b, a)» — для полупрозрачных вариантов цвета (саундвейв: панели с альфой). */
function rgbOf(color: string): string | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  return m ? `${m[1]}, ${m[2]}, ${m[3]}` : null;
}

/** Ставит переменные палитры на `:root`. Возвращает саму палитру. */
export function applyPaletteVars(theme: Pick<ThemeSettings, 'accent' | 'background'>): Record<string, string> {
  const palette = buildPalette(theme.accent, theme.background);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(palette)) root.style.setProperty(name, value);
  const cardRgb = rgbOf(palette['--card']);
  if (cardRgb) root.style.setProperty('--card-rgb', cardRgb);
  root.dataset.scheme = palette['--color-scheme'];
  return palette;
}
