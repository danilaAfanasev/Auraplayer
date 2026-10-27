// Геометрия кривой эквалайзера: где стоят точки, как высота курсора переводится в дБ, путь SVG.
// Координаты — в процентах области кривой (x слева направо, y сверху вниз).
import { EQ_BANDS_HZ, EQ_GAIN_MAX, EQ_GAIN_MIN } from '../../../shared/equalizer';

/** Сколько процентов высоты занимают ±12 дБ от середины (остальное — поля под точку и подпись). */
const SPAN_PCT = 40;

/** Высота точки, % сверху. */
export function gainToY(gain: number): number {
  return 50 - (gain / EQ_GAIN_MAX) * SPAN_PCT;
}

/** Усиление по высоте курсора `y` (px от верха области высотой `height`), зажатое в ±12. */
export function gainFromY(y: number, height: number): number {
  const pct = height > 0 ? (y / height) * 100 : 50;
  const gain = ((50 - pct) / SPAN_PCT) * EQ_GAIN_MAX;
  return Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, gain));
}

/** Положение полосы по ширине, %: десять равных колонок, точка — в середине своей. */
export function bandX(index: number): number {
  return ((index + 0.5) / EQ_BANDS_HZ.length) * 100;
}

const num = (n: number): number => +n.toFixed(2);

/** Плавная кривая (Catmull-Rom → кубические Безье) через все точки, в координатах `width × height`. */
export function curvePath(gains: number[], width: number, height: number): string {
  const pts = gains.map((g, i) => ({ x: (bandX(i) / 100) * width, y: (gainToY(g) / 100) * height }));
  if (pts.length === 0) return '';
  let d = `M${num(pts[0].x)} ${num(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(p2.x)} ${num(p2.y)}`;
  }
  return d;
}

/** «+4 дБ», «0 дБ», «−3,5 дБ». */
export function gainText(gain: number): string {
  const abs = String(Math.abs(gain)).replace('.', ',');
  if (gain > 0) return `+${abs} дБ`;
  if (gain < 0) return `−${abs} дБ`;
  return '0 дБ';
}

/** Новое усиление по клавише на точке; null — клавиша не наша. */
export function keyStep(key: string, gain: number): number | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return gain + 1;
    case 'ArrowDown':
    case 'ArrowLeft':
      return gain - 1;
    case 'PageUp':
      return gain + 3;
    case 'PageDown':
      return gain - 3;
    case 'Home':
      return EQ_GAIN_MIN;
    case 'End':
      return EQ_GAIN_MAX;
    case 'Delete':
    case 'Backspace':
    case '0':
      return 0;
    default:
      return null;
  }
}
