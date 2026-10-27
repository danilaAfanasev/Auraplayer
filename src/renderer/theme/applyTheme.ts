// Применение темы: CSS-переменные из buildPalette на :root.
import { buildPalette } from '../../shared/palette';
import type { ThemeSettings } from '../../shared/types';

/** Ставит переменные палитры на `:root`. Возвращает саму палитру. */
export function applyPaletteVars(theme: Pick<ThemeSettings, 'accent' | 'background'>): Record<string, string> {
  const palette = buildPalette(theme.accent, theme.background);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(palette)) root.style.setProperty(name, value);
  root.dataset.scheme = palette['--color-scheme'];
  return palette;
}
