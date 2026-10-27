import { describe, expect, it } from 'vitest';
import {
  ANALYSER_MAX_DB,
  ANALYSER_MIN_DB,
  bandLevels,
  createWaveDynamics,
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
