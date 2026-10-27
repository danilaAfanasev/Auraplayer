import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex, revealRadius } from './colorMath';

describe('normalizeHex', () => {
  it('приводит короткую и длинную запись к #rrggbb в нижнем регистре', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('7C4DFF')).toBe('#7c4dff');
    expect(normalizeHex('  #1a1033 ')).toBe('#1a1033');
  });

  it('отвергает не-цвета', () => {
    expect(normalizeHex('12')).toBeNull();
    expect(normalizeHex('#12345g')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
});

describe('hsvToHex / hexToHsv', () => {
  it('основные цвета', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
    expect(hsvToHex(0, 0, 0.5)).toBe('#808080');
    expect(hsvToHex(360, 1, 1)).toBe('#ff0000');
  });

  it('разбирает акцент «Аметиста»: оттенок ~256°, насыщенность ~0,70, яркость 1', () => {
    const [h, s, v] = hexToHsv('#7c4dff');
    expect(h).toBeCloseTo(255.8, 0);
    expect(s).toBeCloseTo(0.698, 2);
    expect(v).toBe(1);
  });

  it('серый не имеет оттенка и насыщенности', () => {
    expect(hexToHsv('#808080')).toEqual([0, 0, 128 / 255]);
  });
});

describe('revealRadius', () => {
  it('радиус до самого дальнего угла окна', () => {
    expect(revealRadius(0, 0, 300, 400)).toBe(500);
    expect(revealRadius(300, 400, 300, 400)).toBe(500);
    expect(revealRadius(150, 200, 300, 400)).toBe(250);
  });
});
