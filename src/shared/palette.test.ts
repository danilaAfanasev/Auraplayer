import { describe, expect, it } from 'vitest';
import { buildPalette, DEFAULT_THEME, THEME_PRESETS } from './palette';

// --- независимая реализация WCAG 2.x и альфа-композиции для проверки ---
type RGBA = [number, number, number, number];

function parse(color: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color.trim());
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], rgba[4] === undefined ? 1 : +rgba[4]];
  throw new Error(`не цвет: ${color}`);
}

function over(top: string | RGBA, bottom: RGBA): RGBA {
  const t = typeof top === 'string' ? parse(top) : top;
  const a = t[3];
  return [t[0] * a + bottom[0] * (1 - a), t[1] * a + bottom[1] * (1 - a), t[2] * a + bottom[2] * (1 - a), 1];
}

function luminance([r, g, b]: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Все фоны, на которых в интерфейсе лежит текст: стеклянная карточка поверх подложки и наложения на ней. */
function textBackgrounds(p: Record<string, string>): RGBA[] {
  const result: RGBA[] = [];
  for (const backdrop of [p['--bg'], p['--bg-glow'], p['--bg-deep']]) {
    const card = over(p['--card'], parse(backdrop));
    result.push(card, over(p['--surface'], card), over(p['--surface-2'], card), over(p['--surface-hover'], card));
    result.push(over(p['--accent-soft'], card), over(p['--surface-hover'], over(p['--accent-soft'], card)));
  }
  result.push(parse(p['--popover']));
  return result;
}

function minContrast(color: string, backgrounds: RGBA[]): number {
  const c = parse(color);
  return Math.min(...backgrounds.map((b) => contrast(c, b)));
}

function expectReadable(accent: string, background: string): void {
  const p = buildPalette(accent, background);
  const bgs = textBackgrounds(p);
  expect(minContrast(p['--text'], bgs), `--text для ${accent}/${background}`).toBeGreaterThanOrEqual(4.5);
  expect(minContrast(p['--text-muted'], bgs), `--text-muted для ${accent}/${background}`).toBeGreaterThanOrEqual(4.5);
  expect(minContrast(p['--accent-text'], bgs), `--accent-text для ${accent}/${background}`).toBeGreaterThanOrEqual(4.5);
  expect(minContrast(p['--danger'], bgs), `--danger для ${accent}/${background}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(parse(p['--accent-contrast']), parse(p['--accent'])), `--accent-contrast для ${accent}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(parse(p['--play-icon']), parse(p['--play-bg']))).toBeGreaterThanOrEqual(4.5);
}

describe('THEME_PRESETS', () => {
  it('не меньше 6 пресетов, первый — «Аметист», id уникальны, цвета в формате #rrggbb', () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(THEME_PRESETS[0]).toMatchObject({ id: 'amethyst', name: 'Аметист' });
    expect(new Set(THEME_PRESETS.map((t) => t.id)).size).toBe(THEME_PRESETS.length);
    for (const t of THEME_PRESETS) {
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('тема по умолчанию — «Аметист»', () => {
    const amethyst = THEME_PRESETS[0];
    expect(DEFAULT_THEME).toEqual({ presetId: 'amethyst', accent: amethyst.accent, background: amethyst.background });
  });
  it('есть хотя бы одна светлая тема', () => {
    expect(THEME_PRESETS.some((t) => luminance(parse(t.background)) > 0.5)).toBe(true);
  });
});

describe('buildPalette — контраст ≥ 4.5:1', () => {
  it.each(THEME_PRESETS.map((t) => [t.name, t.accent, t.background]))('пресет %s', (_name, accent, background) => {
    expectReadable(accent, background);
  });

  it.each([
    ['белый фон', '#ff3b5c', '#ffffff'],
    ['светлый фон, жёлтый акцент', '#ffd500', '#f5f0e6'],
    ['чёрный фон, тёмно-синий акцент', '#0a1a66', '#000000'],
    ['средне-серый фон', '#3fa7ff', '#808080'],
    ['средний фон чуть темнее порога', '#ff00ff', '#757575'],
    ['насыщенный красный фон', '#00ff88', '#c0122c'],
    ['светло-зелёный акцент на светлом', '#a6ffcb', '#e9fff2'],
  ])('свои цвета: %s', (_name, accent, background) => {
    expectReadable(accent, background);
  });

  it('случайные пары цветов', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const hex = () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`;
    for (let i = 0; i < 60; i++) expectReadable(hex(), hex());
  });

  it('светлый фон → тёмный текст, тёмный фон → светлый текст', () => {
    expect(luminance(parse(buildPalette('#6d4aff', '#f6f4fb')['--text']))).toBeLessThan(0.1);
    expect(luminance(parse(buildPalette('#6d4aff', '#120c22')['--text']))).toBeGreaterThan(0.7);
  });

  it('акцент сохраняется как есть; неверный цвет — тема по умолчанию', () => {
    expect(buildPalette('#FF3B5C', '#101010')['--accent']).toBe('#ff3b5c');
    expect(buildPalette('нет', 'цвета')).toEqual(buildPalette(DEFAULT_THEME.accent, DEFAULT_THEME.background));
  });
});
