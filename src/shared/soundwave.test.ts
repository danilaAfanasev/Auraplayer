import { describe, expect, it } from 'vitest';
import {
  ANALYSER_MAX_DB,
  ANALYSER_MIN_DB,
  bandLevels,
  createWaveDynamics,
  demoBands,
  SOUNDWAVE_STYLE_NAMES,
  waveShapes,
  type WaveShape,
  stepWaveDynamics,
  WAVE_BANDS,
  waveLines,
  type WaveDynamics,
  type WaveLine,
} from './soundwave';

const W = 1200;
const H = 400;
const opts = { width: W, height: H, lines: 20, step: 8 };

/** Наибольшее отклонение линий от середины на участке [from, to) ширины (доли 0..1). */
function swing(lines: WaveLine[], from = 0, to = 1): number {
  let max = 0;
  for (const line of lines) {
    const n = line.ys.length;
    for (let i = Math.floor(from * (n - 1)); i < Math.ceil(to * (n - 1)); i++) max = Math.max(max, Math.abs(line.ys[i] - H / 2));
  }
  return max;
}

/** Уровень полосы в шкале анализатора (0..1, как `getByteFrequencyData / 255`) по громкости в дБ. */
const raw = (db: number): number => Math.min(1, Math.max(0, (db - ANALYSER_MIN_DB) / (ANALYSER_MAX_DB - ANALYSER_MIN_DB)));
/** Громкий трек: бас громче всего, верх тише (обычный спектр музыки), дБ по полосам. */
const LOUD_DB = [-30, -32, -38, -42, -48, -55];
const spectrum = (db: number[], shift = 0): number[] => db.map((v) => raw(v + shift));
/** Тот же спектр с ударом бочки: бас и низ (полосы 0–1) на 12 дБ громче. */
const withKick = (db: number[], kickDb = 12): number[] => db.map((v, i) => (i < 2 ? v + kickDb : v));

/** Прогоняет кадры, возвращает состояние и историю. */
function run(d: WaveDynamics, frames: number, input: (i: number) => number[], dt: number) {
  const history: WaveDynamics[] = [];
  for (let i = 0; i < frames; i++) {
    d = stepWaveDynamics(d, input(i), dt);
    history.push(d);
  }
  return { d, history };
}

/** Бит: каждые `periodSec` удар бочки длиной ~100 мс (первый — через `offsetSec`), между ударами — ровный спектр. */
const beat = (db: number[], dt: number, periodSec: number, offsetSec = 0) => (i: number) => {
  const t = i * dt - offsetSec;
  return spectrum(t >= 0 && t % periodSec < 0.1 ? withKick(db) : db);
};

describe('bandLevels', () => {
  it('нет анализатора или пусто — все полосы в нуле', () => {
    expect(bandLevels(null)).toEqual(new Array(WAVE_BANDS).fill(0));
    expect(bandLevels(new Uint8Array(0))).toEqual(new Array(WAVE_BANDS).fill(0));
    expect(bandLevels(new Uint8Array(1024))).toEqual(new Array(WAVE_BANDS).fill(0));
  });

  it('полная громкость на всех частотах — все полосы около 1', () => {
    for (const v of bandLevels(new Uint8Array(1024).fill(255), 48000)) expect(v).toBeCloseTo(1, 5);
  });

  it('полосы — по логарифму частоты: бас, низ, низ середины, середина, верх середины, верх — каждый тон в своей полосе', () => {
    // 1024 корзины (fftSize 2048): ширина корзины — sampleRate / 2048.
    const tone = (hz: number, sampleRate: number): Uint8Array => {
      const freq = new Uint8Array(1024);
      const bin = Math.round((hz * 2048) / sampleRate);
      for (let i = bin - 1; i <= bin + 1; i++) freq[i] = 230;
      return freq;
    };
    const loudest = (levels: number[]): number => levels.indexOf(Math.max(...levels));
    const cases: [number, number][] = [
      [60, 0],
      [150, 1],
      [400, 2],
      [1000, 3],
      [2500, 4],
      [6000, 5],
    ];
    for (const [hz, band] of cases) expect(loudest(bandLevels(tone(hz, 48000), 48000)), `${hz} Гц`).toBe(band);
    expect(loudest(bandLevels(tone(1000, 44100), 44100)), '1 кГц при 44,1 кГц').toBe(3);
    expect(loudest(bandLevels(tone(60, 44100), 44100)), '60 Гц при 44,1 кГц').toBe(0);
  });
});

describe('stepWaveDynamics', () => {
  it('удар бочки виден в тот же кадр: бас и низ почти на максимуме, толчок волнам', () => {
    const dt = 1 / 60;
    const { d } = run(createWaveDynamics(), 120, () => spectrum(LOUD_DB), dt);
    const hit = stepWaveDynamics(d, spectrum(withKick(LOUD_DB)), dt);
    expect(hit.levels[0]).toBeGreaterThanOrEqual(0.9);
    expect(hit.levels[1]).toBeGreaterThanOrEqual(0.9);
    expect(hit.punch).toBeGreaterThanOrEqual(0.5);
  });

  it('тишина после удара — уровни и толчок спадают за ≤ 200 мс, при 60 и при 240 к/с', () => {
    for (const fps of [60, 240]) {
      const dt = 1 / fps;
      let { d } = run(createWaveDynamics(), 2 * fps, () => spectrum(LOUD_DB), dt);
      d = stepWaveDynamics(d, spectrum(withKick(LOUD_DB)), dt);
      const after = run(d, Math.round(0.2 * fps), () => new Array(WAVE_BANDS).fill(0), dt).d;
      expect(Math.max(...after.levels), `${fps} к/с`).toBeLessThan(0.1);
      expect(after.punch, `${fps} к/с`).toBeLessThan(0.1);
    }
  });

  it('бит 120 BPM — ровно один толчок на удар; ровный звук без ударов — ни одного и без дрожи', () => {
    const dt = 1 / 60;
    const period = 0.5;
    // Удары в 0,25; 0,75 … 3,75 с — восемь за 4 с.
    const { history } = run(createWaveDynamics(), 4 * 60, beat(LOUD_DB, dt, period, 0.25), dt);
    let hits = 0;
    for (let i = 1; i < history.length; i++) if (history[i].punch > history[i - 1].punch + 0.2) hits++;
    expect(hits).toBe(8);

    const steady = run(createWaveDynamics(), 3 * 60, () => spectrum(LOUD_DB), dt).history.slice(60);
    for (let i = 1; i < steady.length; i++) {
      expect(steady[i].punch).toBeLessThan(0.05);
      for (let k = 0; k < WAVE_BANDS; k++) expect(Math.abs(steady[i].levels[k] - steady[i - 1].levels[k])).toBeLessThan(1e-3);
    }
  });

  it('автоусиление: тихий трек (−24 дБ) прыгает в бит заметно, громкий не упирается в потолок', () => {
    const dt = 1 / 60;
    for (const shift of [0, -24]) {
      const db = LOUD_DB.map((v) => v + shift);
      const { history } = run(createWaveDynamics(), 6 * 60, beat(db, dt, 0.5), dt);
      const bass = history.slice(-120).map((d) => d.levels[0]);
      expect(Math.max(...bass), `сдвиг ${shift} дБ: удар`).toBeGreaterThanOrEqual(0.85);
      expect(Math.min(...bass), `сдвиг ${shift} дБ: между ударами`).toBeLessThanOrEqual(0.6);
    }
  });
});

describe('waveLines', () => {
  it('столько линий, сколько просили; точки по всей ширине с шагом; внутри холста', () => {
    const lines = waveLines([1, 1, 1, 1, 1, 1], 3.7, opts);
    expect(lines).toHaveLength(20);
    for (const line of lines) {
      expect(line.ys).toHaveLength(W / 8 + 1);
      for (const y of line.ys) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(H);
      }
      expect(line.width).toBeGreaterThan(0);
      expect(line.alpha).toBeGreaterThan(0);
      expect(line.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('тишина (пауза, нет трека) — тихий дрейф: почти ровно, но не мёртвая линия', () => {
    const quiet = waveLines(new Array(WAVE_BANDS).fill(0), 12.3, opts);
    expect(swing(quiet)).toBeLessThan(H * 0.08);
    expect(swing(quiet)).toBeGreaterThan(0);
  });

  it('громкий звук — волны высокие и по всей ширине окна', () => {
    const quiet = waveLines(new Array(WAVE_BANDS).fill(0), 12.3, opts);
    const loud = waveLines(new Array(WAVE_BANDS).fill(1), 12.3, opts);
    expect(swing(loud)).toBeGreaterThan(H * 0.25);
    expect(swing(loud)).toBeGreaterThan(swing(quiet) * 4);
    for (const [from, to] of [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]) expect(swing(loud, from, to)).toBeGreaterThan(H * 0.12);
  });

  it('толчок удара раскачивает волны сильнее при тех же уровнях', () => {
    const levels = [0.6, 0.5, 0.4, 0.4, 0.3, 0.3];
    const calm = waveLines(levels, 4.2, { ...opts, punch: 0 });
    const kicked = waveLines(levels, 4.2, { ...opts, punch: 1 });
    expect(swing(kicked)).toBeGreaterThan(swing(calm) * 1.2);
  });

  it('кадр зависит только от уровней и времени: одинаковые входы — одинаковый кадр, время идёт — волна движется', () => {
    const a = waveLines([0.5, 0.2, 0.9, 0.1, 0.4, 0.7], 5, opts);
    const b = waveLines([0.5, 0.2, 0.9, 0.1, 0.4, 0.7], 5, opts);
    const c = waveLines([0.5, 0.2, 0.9, 0.1, 0.4, 0.7], 5.5, opts);
    expect(a).toEqual(b);
    expect(a[0].ys).not.toEqual(c[0].ys);
  });

  it('пустой холст — ни одной точки', () => {
    expect(waveLines([1, 1, 1, 1, 1, 1], 1, { ...opts, width: 0 })).toEqual([]);
  });
});

// --- Виды саундвейва: геометрия кадра ---

const STYLES = ['waves', 'blocks', 'dots', 'mirror', 'ring', 'scope'] as const;
const SW = 900;
const SH = 360;
const shapeOpts = { width: SW, height: SH };
const LOUD = [1, 1, 1, 1, 1, 1];
const QUIET = [0, 0, 0, 0, 0, 0];
const MID = [0.6, 0.5, 0.4, 0.4, 0.3, 0.3];

/** Все точки кадра: [x, y] (у квадратиков — два угла, у точек — центр ± радиус). */
function points(shapes: WaveShape[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of shapes) {
    if (s.type === 'stroke' || s.type === 'fill') {
      for (const path of s.paths) for (let i = 0; i + 1 < path.length; i += 2) out.push([path[i], path[i + 1]]);
    } else if (s.type === 'rects') {
      for (let i = 0; i + 3 < s.rects.length; i += 4) {
        const [x, y, w, h] = s.rects.slice(i, i + 4);
        out.push([x, y], [x + w, y + h]);
      }
    } else {
      for (let i = 0; i + 2 < s.dots.length; i += 3) {
        const [x, y, r] = s.dots.slice(i, i + 3);
        out.push([x - r, y - r], [x + r, y + r]);
      }
    }
  }
  return out;
}

/** «Размах» кадра: квадратики — их общая площадь; кольцо — наибольший радиус от центра; остальные — отклонение от середины. */
function extent(style: (typeof STYLES)[number], shapes: WaveShape[], cx = SW / 2, cy = SH / 2): number {
  if (style === 'blocks') {
    let area = 0;
    for (const s of shapes) if (s.type === 'rects') for (let i = 0; i + 3 < s.rects.length; i += 4) area += s.rects[i + 2] * s.rects[i + 3];
    return area;
  }
  let max = 0;
  for (const [x, y] of points(shapes)) max = Math.max(max, style === 'ring' ? Math.hypot(x - cx, y - cy) : Math.abs(y - SH / 2));
  return max;
}

describe('waveShapes: шесть видов от одних уровней', () => {
  it('у каждого вида есть имя по-русски', () => {
    expect(STYLES.map((s) => SOUNDWAVE_STYLE_NAMES[s])).toEqual(['Волны', 'Квадратики', 'Точки', 'Зеркальная волна', 'Кольцо', 'Осциллограф']);
  });

  it('громко — кадр внутри холста, без NaN; немного штрихов на кадр (не больше 8 групп), линии не толще 5 px', () => {
    for (const style of STYLES) {
      const shapes = waveShapes(style, LOUD, 3.3, { ...shapeOpts, punch: 1 });
      expect(shapes.length, style).toBeGreaterThan(0);
      expect(shapes.length, style).toBeLessThanOrEqual(8);
      const pts = points(shapes);
      expect(pts.length, style).toBeGreaterThan(10);
      for (const [x, y] of pts) {
        expect(Number.isFinite(x) && Number.isFinite(y), style).toBe(true);
        expect(x, style).toBeGreaterThanOrEqual(-0.5);
        expect(x, style).toBeLessThanOrEqual(SW + 0.5);
        expect(y, style).toBeGreaterThanOrEqual(-0.5);
        expect(y, style).toBeLessThanOrEqual(SH + 0.5);
      }
      for (const s of shapes) {
        expect(s.alpha, style).toBeGreaterThan(0);
        expect(s.alpha, style).toBeLessThanOrEqual(1);
        if (s.type === 'stroke') expect(s.width, style).toBeLessThanOrEqual(5);
      }
    }
  });

  it('громче — крупнее: громкий кадр заметно больше тихого, а тишина всё равно видна (пауза — едва живой вид)', () => {
    // У кольца неподвижна внутренняя окружность — сравниваем то, что вокруг неё.
    const ring = { x: SW / 2, y: SH / 2, radius: 80 };
    for (const style of STYLES) {
      const base = style === 'ring' ? ring.radius : 0;
      const quiet = extent(style, waveShapes(style, QUIET, 2, { ...shapeOpts, ring })) - base;
      const loud = extent(style, waveShapes(style, LOUD, 2, { ...shapeOpts, ring })) - base;
      expect(quiet, `${style}: тишина видна`).toBeGreaterThan(0);
      expect(loud, `${style}: громко больше тихого`).toBeGreaterThan(quiet * 1.8);
    }
  });

  it('удар (punch) при тех же уровнях — кадр крупнее, в тот же кадр', () => {
    for (const style of STYLES) {
      const calm = extent(style, waveShapes(style, MID, 4.2, { ...shapeOpts, punch: 0 }));
      const kicked = extent(style, waveShapes(style, MID, 4.2, { ...shapeOpts, punch: 1 }));
      expect(kicked, style).toBeGreaterThan(calm * 1.05);
    }
  });

  it('кадр зависит только от входов; время идёт — движется', () => {
    for (const style of STYLES) {
      const a = waveShapes(style, MID, 5, shapeOpts);
      expect(waveShapes(style, MID, 5, shapeOpts), style).toEqual(a);
      expect(waveShapes(style, MID, 5.7, shapeOpts), style).not.toEqual(a);
    }
  });

  it('пустой холст — пусто', () => {
    for (const style of STYLES) expect(waveShapes(style, LOUD, 1, { width: 0, height: SH })).toEqual([]);
  });

  it('квадратики: квадратные клетки, бас слева — громкий бас поднимает левые столбики, а не правые', () => {
    const shapes = waveShapes('blocks', [1, 1, 0, 0, 0, 0], 1, shapeOpts);
    let left = 0;
    let right = 0;
    for (const s of shapes) {
      if (s.type !== 'rects') continue;
      for (let i = 0; i + 3 < s.rects.length; i += 4) {
        expect(s.rects[i + 2]).toBeCloseTo(s.rects[i + 3], 5);
        if (s.rects[i] < SW / 3) left++;
        else if (s.rects[i] > (SW * 2) / 3) right++;
      }
    }
    expect(left).toBeGreaterThan(right * 3);
  });

  it('кольцо — вокруг заданного центра и не заходит внутрь радиуса (обложку на экране текста не перекрывает)', () => {
    const ring = { x: 300, y: 170, radius: 90 };
    for (const levels of [QUIET, LOUD]) {
      const pts = points(waveShapes('ring', levels, 2.5, { ...shapeOpts, ring }));
      const cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
      const cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
      expect(Math.abs(cx - ring.x)).toBeLessThan(12);
      expect(Math.abs(cy - ring.y)).toBeLessThan(12);
      for (const [x, y] of pts) expect(Math.hypot(x - ring.x, y - ring.y)).toBeGreaterThanOrEqual(ring.radius - 0.5);
    }
    const quiet = extent('ring', waveShapes('ring', QUIET, 2.5, { ...shapeOpts, ring }), ring.x, ring.y);
    const loud = extent('ring', waveShapes('ring', LOUD, 2.5, { ...shapeOpts, ring }), ring.x, ring.y);
    expect(loud - ring.radius).toBeGreaterThan((quiet - ring.radius) * 3);
  });

  it('по умолчанию кольцо — по центру холста', () => {
    const pts = points(waveShapes('ring', MID, 1, shapeOpts));
    expect(Math.abs(pts.reduce((s, [x]) => s + x, 0) / pts.length - SW / 2)).toBeLessThan(12);
    expect(Math.abs(pts.reduce((s, [, y]) => s + y, 0) / pts.length - SH / 2)).toBeLessThan(12);
  });
});

describe('demoBands: звук для превью, когда ничего не играет', () => {
  it('уровни в шкале анализатора, бит меняет их со временем', () => {
    const frames = Array.from({ length: 60 }, (_, i) => demoBands(i / 30));
    for (const f of frames) {
      expect(f).toHaveLength(WAVE_BANDS);
      for (const v of f) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    const bass = frames.map((f) => f[0]);
    expect(Math.max(...bass) - Math.min(...bass)).toBeGreaterThan(0.05);
  });
});
