import { describe, expect, it } from 'vitest';
import { bandX, curvePath, gainFromY, gainToY, gainText, keyStep } from './eqGeometry';

describe('кривая эквалайзера', () => {
  it('0 дБ — середина высоты, +12 вверху, −12 внизу (с полями под точку)', () => {
    expect(gainToY(0)).toBe(50);
    expect(gainToY(12)).toBeLessThan(15);
    expect(gainToY(-12)).toBeGreaterThan(85);
    expect(gainToY(6)).toBeCloseTo((gainToY(12) + 50) / 2);
  });

  it('точку тянут мышью: высота курсора → усиление, за краем — предел', () => {
    for (const g of [-12, -4.5, 0, 3, 12]) expect(gainFromY(gainToY(g), 100)).toBeCloseTo(g);
    expect(gainFromY(-30, 100)).toBe(12);
    expect(gainFromY(130, 100)).toBe(-12);
    // Высота в пикселях — так же, как в процентах.
    expect(gainFromY((gainToY(4) / 100) * 220, 220)).toBeCloseTo(4);
  });

  it('полосы равномерно по ширине, первая и последняя не на краю', () => {
    expect(bandX(0)).toBe(5);
    expect(bandX(9)).toBe(95);
    expect(bandX(1) - bandX(0)).toBeCloseTo(10);
  });

  it('кривая проходит через все 10 точек', () => {
    const gains = [6, 5, 4, 2, 0, 0, 0, 0, 0, -3];
    const d = curvePath(gains, 1000, 200);
    expect(d.startsWith(`M50 ${(gainToY(6) / 100) * 200}`)).toBe(true);
    expect(d.trim().endsWith(`950 ${(gainToY(-3) / 100) * 200}`)).toBe(true);
    expect(d.match(/C/g)).toHaveLength(9);
  });

  it('подпись значения: «+4 дБ», «0 дБ», «−3,5 дБ»', () => {
    expect(gainText(4)).toBe('+4 дБ');
    expect(gainText(0)).toBe('0 дБ');
    expect(gainText(-3.5)).toBe('−3,5 дБ');
  });

  it('клавиатура: стрелки ±1 дБ, PageUp/PageDown ±3, Home/End — пределы, прочие клавиши — мимо', () => {
    expect(keyStep('ArrowUp', 2)).toBe(3);
    expect(keyStep('ArrowRight', 2)).toBe(3);
    expect(keyStep('ArrowDown', 2)).toBe(1);
    expect(keyStep('ArrowLeft', 2)).toBe(1);
    expect(keyStep('PageUp', 2)).toBe(5);
    expect(keyStep('PageDown', 2)).toBe(-1);
    expect(keyStep('Home', 2)).toBe(-12);
    expect(keyStep('End', 2)).toBe(12);
    expect(keyStep('Delete', 2)).toBe(0);
    expect(keyStep('a', 2)).toBeNull();
  });
});
