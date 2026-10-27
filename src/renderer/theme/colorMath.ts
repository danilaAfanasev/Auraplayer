// Чистая математика цвета для выбора цвета и анимации заливки.
import { parseHex, toHex } from '../../shared/palette';

/** '#ABC' / '7C4DFF' → '#aabbcc'; не цвет → null. */
export function normalizeHex(input: string): string | null {
  const rgb = parseHex(input);
  return rgb ? toHex(rgb) : null;
}

/** h: 0..360, s и v: 0..1 → '#rrggbb'. */
export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const sector = Math.floor(hue / 60);
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** '#rrggbb' → [h 0..360, s 0..1, v 0..1]. Невалидный цвет — чёрный. */
export function hexToHsv(hex: string): [number, number, number] {
  const rgb = parseHex(hex);
  if (!rgb) return [0, 0, 0];
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** Радиус круга от точки (x, y) до самого дальнего угла окна w×h. */
export function revealRadius(x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
}
