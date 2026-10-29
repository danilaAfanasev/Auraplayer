import { describe, expect, it } from 'vitest';
import { ladderLayout, ladderStyle, lyricsButtonLabel, lyricsEmptyMessage, plainParagraphs } from './lyricsView';

describe('lyricsButtonLabel: три состояния кнопки «Текст»', () => {
  it('текст есть — обычная подсказка', () => {
    expect(lyricsButtonLabel('ready')).toBe('Текст песни');
  });
  it('текст ищется — «Текст загружается…»', () => {
    expect(lyricsButtonLabel('loading')).toBe('Текст загружается…');
  });
  it('текста нет, не нашёлся или сбой — «Текста нет»', () => {
    for (const status of ['none', 'error', 'idle'] as const) expect(lyricsButtonLabel(status)).toBe('Текста нет');
  });
});

describe('lyricsEmptyMessage: что слой пишет вместо текста', () => {
  it('грузится — ждём; нет текста — «Текста нет»; сбой — отдельная фраза', () => {
    expect(lyricsEmptyMessage('loading')).toBe('Текст загружается…');
    expect(lyricsEmptyMessage('none')).toBe('Текста нет');
    expect(lyricsEmptyMessage('idle')).toBe('Текста нет');
    expect(lyricsEmptyMessage('error')).toBe('Не удалось загрузить текст');
  });
});

describe('plainParagraphs', () => {
  it('делит простой текст на абзацы по пустым строкам, строки сохраняет', () => {
    expect(plainParagraphs('раз\nдва\n\nтри\nчетыре\n')).toEqual([['раз', 'два'], ['три', 'четыре']]);
  });
  it('лишние пустые строки, пробелы и \r не плодят пустых абзацев', () => {
    expect(plainParagraphs('\r\n  а  \r\n\r\n\r\n\r\nб\r\n\r\n')).toEqual([['а'], ['б']]);
  });
  it('пусто — нет абзацев', () => {
    expect(plainParagraphs('  \n\n ')).toEqual([]);
  });
});

describe('ladderStyle: лесенка строк вокруг текущей', () => {
  it('текущая — полный размер и непрозрачность, соседние — заметно мельче (в 1,3–1,5 раза)', () => {
    expect(ladderStyle(0)).toEqual({ scale: 1, opacity: 1 });
    const ratio = ladderStyle(0).scale / ladderStyle(1).scale;
    expect(ratio).toBeGreaterThanOrEqual(1.3);
    expect(ratio).toBeLessThanOrEqual(1.5);
  });

  it('каждая ступень вверх и вниз — мельче и прозрачнее, до нижнего предела читаемости', () => {
    for (let d = 1; d < 12; d++) {
      const near = ladderStyle(d);
      const far = ladderStyle(d + 1);
      expect(far.scale).toBeLessThanOrEqual(near.scale);
      expect(far.opacity).toBeLessThanOrEqual(near.opacity);
      expect(ladderStyle(-d)).toEqual(near);
    }
    expect(ladderStyle(2).scale).toBeLessThan(ladderStyle(1).scale);
    expect(ladderStyle(3).opacity).toBeLessThan(ladderStyle(2).opacity);
    expect(ladderStyle(40).scale).toBeGreaterThanOrEqual(0.5);
    expect(ladderStyle(40).opacity).toBeGreaterThanOrEqual(0.2);
  });
});

describe('ladderLayout: строки сжимаются к текущей без дыр', () => {
  const H = 50;
  const GAP = 4;
  const heights = new Array(11).fill(H);
  const noSkip = new Array(11).fill(false);

  it('текущая на своём месте и крупная; соседи — ступенями, симметрично; ниже — вверх, выше — вниз', () => {
    const rows = ladderLayout(heights, noSkip, 5);
    expect(rows[5]).toEqual({ scale: 1, opacity: 1, shift: 0 });
    expect(rows[4].scale).toBe(ladderStyle(1).scale);
    expect(rows[6].scale).toBe(ladderStyle(1).scale);
    expect(rows[8].opacity).toBe(ladderStyle(3).opacity);
    for (let d = 1; d <= 5; d++) {
      expect(rows[5 + d].shift).toBeLessThan(0);
      expect(rows[5 - d].shift).toBeCloseTo(-rows[5 + d].shift, 6);
    }
  });

  it('между уменьшенными строками — тот же зазор, что в вёрстке (нет дыр и наложений)', () => {
    const rows = ladderLayout(heights, noSkip, 5);
    // Естественный центр строки i — i * (H + GAP); видимая высота — H * scale.
    const top = (i: number) => i * (H + GAP) + rows[i].shift - (H * rows[i].scale) / 2;
    const bottom = (i: number) => i * (H + GAP) + rows[i].shift + (H * rows[i].scale) / 2;
    for (let i = 0; i < 10; i++) expect(top(i + 1) - bottom(i)).toBeCloseTo(GAP, 6);
  });

  it('строка в две строки выше остальных — соседи отодвинуты на её высоту, а не наложены', () => {
    const tall = [...heights];
    tall[6] = 2 * H;
    const rows = ladderLayout(tall, noSkip, 5);
    const center = (i: number) => tall.slice(0, i).reduce((s, h) => s + h + GAP, 0) + tall[i] / 2;
    const top = (i: number) => center(i) + rows[i].shift - (tall[i] * rows[i].scale) / 2;
    const bottom = (i: number) => center(i) + rows[i].shift + (tall[i] * rows[i].scale) / 2;
    for (let i = 4; i < 9; i++) expect(top(i + 1) - bottom(i)).toBeCloseTo(GAP, 6);
  });

  it('перемотка: лесенка строится от строки-цели', () => {
    const rows = ladderLayout(heights, noSkip, 8);
    expect(rows[8]).toEqual({ scale: 1, opacity: 1, shift: 0 });
    expect(rows[7].scale).toBe(ladderStyle(1).scale);
    expect(rows[5].scale).toBe(ladderStyle(3).scale);
  });

  it('пустые строки-паузы не считаются ступенью', () => {
    const skip = noSkip.map((_, i) => i === 6);
    const rows = ladderLayout(heights, skip, 5);
    expect(rows[7].scale).toBe(ladderStyle(1).scale);
    expect(rows[8].scale).toBe(ladderStyle(2).scale);
  });

  it('до первой строки (-1) — никто не выделен, первая строка — ближняя ступень на своём месте', () => {
    const rows = ladderLayout(heights, noSkip, -1);
    expect(rows[0].scale).toBe(ladderStyle(1).scale);
    expect(rows[0].shift).toBe(0);
    expect(rows[1].scale).toBe(ladderStyle(2).scale);
    expect(rows.every((r) => r.scale < 1)).toBe(true);
  });
});
