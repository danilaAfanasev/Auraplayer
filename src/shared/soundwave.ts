// Саундвейв на фоне окна — чистая математика кадра, без DOM (рисует `components/Soundwave`).
// Частоты анализатора → уровни полос по логарифму частоты → автоусиление по скользящему пику и
// огибающая (рост — в тот же кадр, спад — ~200 мс) + детектор удара (толчок волнам) → огибающая из
// «горбов» по ширине окна; поверх неё — пучок тонких синусоид с разной частотой и фазой (как на
// референсе: много наложенных линий, ярче несколько «сердцевинных»). Тишина — едва заметный дрейф.

// Виды (`SoundwaveStyle`): «Волны» — этот пучок; «Квадратики», «Точки», «Зеркальная волна», «Кольцо»,
// «Осциллограф» — от тех же уровней и толчка (`waveShapes`).

import type { SoundwaveStyle } from './types';

/** Сколько полос частот ведут волну (по одному «горбу» огибающей на полосу). */
export const WAVE_BANDS = 6;

/**
 * Края полос, Гц, по логарифму частоты: бочка/суббас, бас, низ середины, середина, верх середины, верх.
 * Выше ~12 кГц в музыке почти пусто — туда полос нет.
 */
export const BAND_EDGES_HZ = [30, 90, 250, 600, 1500, 4000, 12000] as const;

/**
 * Шкала анализатора (`minDecibels`/`maxDecibels` в `audioGraph`): байт 0..255 — линейно по дБ в этих
 * пределах. Потолок с запасом, чтобы громкие треки не упирались в 255 до автоусиления.
 */
export const ANALYSER_MIN_DB = -100;
export const ANALYSER_MAX_DB = -10;

/** Частота дискретизации, если не передали (обычная для Windows). */
const DEFAULT_SAMPLE_RATE = 48000;

/**
 * Уровни полос 0..1 из `getByteFrequencyData` (`/255`, то есть линейно по дБ шкалы анализатора):
 * среднее корзин полосы `BAND_EDGES_HZ`. null/пусто — тишина. Автоусиления здесь нет — оно в `stepWaveDynamics`.
 */
export function bandLevels(freq: Uint8Array | null, sampleRate = DEFAULT_SAMPLE_RATE): number[] {
  const levels = new Array<number>(WAVE_BANDS).fill(0);
  if (!freq || freq.length < 4) return levels;
  const binHz = sampleRate / (freq.length * 2);
  for (let k = 0; k < WAVE_BANDS; k++) {
    const start = Math.min(freq.length - 1, Math.max(1, Math.round(BAND_EDGES_HZ[k] / binHz)));
    const end = Math.min(freq.length, Math.max(start + 1, Math.round(BAND_EDGES_HZ[k + 1] / binHz)));
    let sum = 0;
    for (let i = start; i < end; i++) sum += freq[i];
    levels[k] = sum / (end - start) / 255;
  }
  return levels;
}

// --- Динамика: автоусиление, огибающая, удар ---

/** Диапазон под пиком, дБ, который растягивается на 0..1: на столько тише пика — уже ноль. */
const GAIN_RANGE_DB = 20;
/** Ниже этого пик не опускается: тишина и шум не растягиваются в полную волну. */
const PEAK_FLOOR_DB = -70;
/** Скользящий пик трека забывается со скоростью, дБ/с: тихий куплет после громкого припева снова «прыгает». */
const PEAK_FALL_DB_PER_SEC = 3;
/** Кривая уровня: >1 — ровный фон ниже, удары выше. */
const LEVEL_SHAPE = 1.6;
/** Спад уровня: постоянная времени, с (от 1 до <0,1 — за ~130 мс, полностью — за ~200 мс). */
const RELEASE_TAU_SEC = 0.055;
/** Среднее энергии для детектора удара — за ~0,5 с. */
const ONSET_AVG_TAU_SEC = 0.5;
/** Удар: энергия группы полос выше своего среднего на столько дБ. */
const HIT_DB = 6;
/** Среднее не отстаёт от текущей энергии больше чем на столько дБ (после тишины удары ловятся через ~1 с). */
const ONSET_AVG_LAG_DB = 18;
/** Тише этого — не удар, а шум. */
const HIT_GATE_DB = -75;
/** Между толчками не меньше, с: бочка и малый в одном ударе — один толчок. */
const MIN_HIT_GAP_SEC = 0.1;
/** Спад толчка: постоянная времени, с. */
const PUNCH_TAU_SEC = 0.07;
/** Группы полос детектора удара: бочка+бас, низ середины+середина (малый, атака вокала). */
const ONSET_GROUPS: readonly (readonly number[])[] = [
  [0, 1],
  [2, 3],
];

export interface WaveDynamics {
  /** Уровни полос для кадра, 0..1. */
  levels: number[];
  /** Толчок удара, 0..1: в кадр удара — вверх, потом быстро спадает. */
  punch: number;
  /** Скользящий пик каждой полосы, дБ. */
  peaks: number[];
  /** Среднее энергии групп детектора, дБ; null — ещё не было кадра. */
  onsetAvg: (number | null)[];
  /** Группа готова к новому удару (энергия вернулась к среднему после прошлого). */
  armed: boolean[];
  /** Секунд с последнего толчка. */
  sinceHit: number;
}

export function createWaveDynamics(bands = WAVE_BANDS): WaveDynamics {
  return {
    levels: new Array<number>(bands).fill(0),
    punch: 0,
    peaks: new Array<number>(bands).fill(PEAK_FLOOR_DB),
    onsetAvg: ONSET_GROUPS.map(() => null),
    armed: ONSET_GROUPS.map(() => true),
    sinceHit: Infinity,
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const toDb = (raw: number): number => ANALYSER_MIN_DB + clamp01(raw) * (ANALYSER_MAX_DB - ANALYSER_MIN_DB);

/**
 * Следующий кадр динамики: `raw` — уровни `bandLevels`, `dtSec` — время с прошлого кадра (любая частота
 * кадров даёт одно и то же поведение во времени). Рост уровня — в тот же кадр, спад — экспонентой ~200 мс;
 * автоусиление — от скользящего пика полосы; удар — резкий рост энергии баса или середины над её средним.
 */
export function stepWaveDynamics(d: WaveDynamics, raw: number[], dtSec: number): WaveDynamics {
  const dt = Math.max(0, Math.min(0.25, dtSec));
  const db = d.levels.map((_, k) => toDb(raw[k] ?? 0));

  const release = Math.exp(-dt / RELEASE_TAU_SEC);
  const peaks = db.map((v, k) => Math.max(v, (d.peaks[k] ?? PEAK_FLOOR_DB) - PEAK_FALL_DB_PER_SEC * dt, PEAK_FLOOR_DB));
  const levels = db.map((v, k) => {
    const target = Math.pow(clamp01(1 - (peaks[k] - v) / GAIN_RANGE_DB), LEVEL_SHAPE);
    const prev = d.levels[k] ?? 0;
    return target >= prev ? target : target + (prev - target) * release;
  });

  const follow = 1 - Math.exp(-dt / ONSET_AVG_TAU_SEC);
  let sinceHit = d.sinceHit + dt;
  let punch = d.punch * Math.exp(-dt / PUNCH_TAU_SEC);
  const armed = [...d.armed];
  const onsetAvg = ONSET_GROUPS.map((group, g) => {
    const energy = group.reduce((s, k) => s + (db[k] ?? ANALYSER_MIN_DB), 0) / group.length;
    const avg = Math.max(d.onsetAvg[g] ?? energy, energy - ONSET_AVG_LAG_DB);
    const excess = energy - avg;
    if (armed[g] && excess > HIT_DB && energy > HIT_GATE_DB) {
      armed[g] = false;
      if (sinceHit >= MIN_HIT_GAP_SEC) {
        punch = Math.max(punch, Math.min(1, 0.6 + (excess - HIT_DB) / 15));
        sinceHit = 0;
      }
    } else if (!armed[g] && excess < HIT_DB / 2) armed[g] = true;
    return avg + (energy - avg) * follow;
  });

  return { levels, punch, peaks, onsetAvg, armed, sinceHit };
}

// --- Кадр: линии волны ---

export interface WaveOptions {
  width: number;
  height: number;
  /** Сколько линий в пучке. */
  lines?: number;
  /** Шаг точек по горизонтали, px. */
  step?: number;
  /** Толчок удара 0..1 (`WaveDynamics.punch`): раскачивает весь пучок сильнее. */
  punch?: number;
}

export interface WaveLine {
  /** Высоты точек слева направо; x точки i — `i * step`. */
  ys: number[];
  /** Толщина линии в пикселях экрана, ≤ 1: тоньше пикселя — «волосок», его видеокарта рисует почти даром. */
  width: number;
  /** Непрозрачность 0..1 — одна из немногих ступеней: линии с одинаковыми толщиной и непрозрачностью рисуются одним штрихом. */
  alpha: number;
}

const DEFAULT_LINES = 22;
const DEFAULT_STEP = 8;
/** Сколько линий — яркая «сердцевина» пучка. */
const CORE_LINES = 4;
/** Огибающая без звука: тихий дрейф. */
const IDLE_ENVELOPE = 0.08;
/** Доля высоты холста, на которую волна может отклониться от середины. */
const MAX_SWING = 0.44;
/** Насколько толчок удара увеличивает размах (1 — вдвое). */
const PUNCH_SWING = 0.5;
/** Ступени непрозрачности тонких линий. */
const THIN_ALPHAS = [0.22, 0.36, 0.5];
/** Где по ширине стоят «горбы» и какая полоса ведёт каждый: басы не прижаты к левому краю. */
const PEAKS: { at: number; band: number; width: number }[] = [
  { at: 0.08, band: 2, width: 0.07 },
  { at: 0.24, band: 0, width: 0.085 },
  { at: 0.41, band: 4, width: 0.06 },
  { at: 0.58, band: 1, width: 0.09 },
  { at: 0.75, band: 5, width: 0.065 },
  { at: 0.92, band: 3, width: 0.075 },
];

/** Огибающая волны в точке u (0..1 по ширине). */
function envelopeAt(u: number, peaks: { c: number; w: number; a: number }[]): number {
  let env = IDLE_ENVELOPE;
  for (const p of peaks) {
    const d = (u - p.c) / p.w;
    env += p.a * Math.exp(-d * d);
  }
  return env;
}

/** Неизменная часть линий для данного размера: синусы по точкам считаются один раз, а не каждый кадр. */
interface LineShape {
  /** sin/cos фазы точки (без времени) и «покачивание» × разброс линии. */
  sin: Float64Array;
  cos: Float64Array;
  gain: Float64Array;
  width: number;
  alpha: number;
}
let shapeCache: { key: string; shapes: LineShape[] } | null = null;

function lineShapes(width: number, count: number, step: number, points: number): LineShape[] {
  const key = `${width}|${count}|${step}`;
  if (shapeCache?.key === key) return shapeCache.shapes;
  const shapes: LineShape[] = [];
  for (let n = 0; n < count; n++) {
    const core = n < CORE_LINES;
    const cycles = 7 + (n % 5) * 1.15; // волн на ширину окна
    const phase = n * 0.41;
    const spread = core ? 0.5 : 0.5 + 0.5 * Math.abs(Math.sin(n * 1.7));
    const shape: LineShape = {
      sin: new Float64Array(points),
      cos: new Float64Array(points),
      gain: new Float64Array(points),
      width: core ? 1 : 0.7,
      alpha: core ? 0.9 : THIN_ALPHAS[Math.floor(Math.abs(Math.sin(n * 2.3)) * THIN_ALPHAS.length) % THIN_ALPHAS.length],
    };
    for (let i = 0; i < points; i++) {
      const u = (i * step) / width;
      const a = u * cycles * 2 * Math.PI + phase;
      shape.sin[i] = Math.sin(a);
      shape.cos[i] = Math.cos(a);
      shape.gain[i] = spread * (0.6 + 0.4 * Math.sin(u * 11 + n));
    }
    shapes.push(shape);
  }
  shapeCache = { key, shapes };
  return shapes;
}

/** Линии кадра: зависят только от уровней полос, толчка и времени `t` (секунды). */
export function waveLines(levels: number[], t: number, opts: WaveOptions): WaveLine[] {
  const { width, height } = opts;
  if (width <= 0 || height <= 0) return [];
  const count = opts.lines ?? DEFAULT_LINES;
  const step = opts.step ?? DEFAULT_STEP;
  const points = Math.floor(width / step) + 1;
  const mid = height / 2;
  const swingPx = height * MAX_SWING * (1 + PUNCH_SWING * clamp01(opts.punch ?? 0));

  const peaks = PEAKS.map((p, k) => ({
    c: p.at + 0.025 * Math.sin(t * 0.35 + k * 1.3),
    w: p.width,
    a: (levels[p.band] ?? 0) * (0.8 + 0.2 * Math.sin(t * 1.4 + k * 1.9)),
  }));
  const env = new Float64Array(points);
  for (let i = 0; i < points; i++) env[i] = swingPx * envelopeAt((i * step) / width, peaks);

  // sin(a + 2,3·t) = sin a · cos(2,3·t) + cos a · sin(2,3·t): время — два числа на кадр.
  // Мягкий предел (tanh) вместо обрезки: сильный удар упирается в край холста плавно, без плоских срезов.
  const sinT = Math.sin(t * 2.3);
  const cosT = Math.cos(t * 2.3);
  const room = Math.max(0, mid - 1);
  return lineShapes(width, count, step, points).map((shape) => {
    const ys = new Array<number>(points);
    for (let i = 0; i < points; i++) {
      const off = env[i] * shape.gain[i] * (shape.sin[i] * cosT + shape.cos[i] * sinT);
      ys[i] = room > 0 ? mid + room * Math.tanh(off / room) : mid;
    }
    return { ys, width: shape.width, alpha: shape.alpha };
  });
}

// --- Виды саундвейва: геометрия кадра ---
// Все виды берут одно и то же: уровни полос и толчок удара (`stepWaveDynamics`) и время `t`. Кадр — несколько
// групп примитивов; каждая группа рисуется одним вызовом (один штрих, одна заливка), поэтому вызовов на кадр
// единицы, а не сотни. Тяжёлых эффектов (размытие, тени) нет: кадр рисуется на частоте экрана.

export const SOUNDWAVE_STYLE_NAMES: Record<SoundwaveStyle, string> = {
  waves: 'Волны',
  blocks: 'Квадратики',
  dots: 'Точки',
  mirror: 'Зеркальная волна',
  ring: 'Кольцо',
  scope: 'Осциллограф',
};

/** Кольцо: центр и внутренний радиус в пикселях холста (на экране текста — вокруг обложки). */
export interface WaveRing {
  x: number;
  y: number;
  radius: number;
}

export interface WaveShapeOptions {
  width: number;
  height: number;
  /** Толчок удара 0..1 (`WaveDynamics.punch`). */
  punch?: number;
  /** Шаг точек «Волн», px. */
  step?: number;
  /** «Кольцо»: где и какого размера; по умолчанию — по центру холста. */
  ring?: WaveRing;
}

/**
 * Одна группа кадра — один вызов рисования. Координаты — в пикселях холста (CSS).
 * `stroke.paths` — ломаные `[x0, y0, x1, y1, …]`; `screen` — толщина в пикселях экрана, а не холста (волоски «Волн»);
 * `fill.paths` — замкнутые многоугольники; `rects` — `[x, y, w, h, …]`; `dots` — `[x, y, r, …]`.
 */
export type WaveShape =
  | { type: 'stroke'; paths: number[][]; width: number; alpha: number; screen?: boolean }
  | { type: 'fill'; paths: number[][]; alpha: number }
  | { type: 'rects'; rects: number[]; alpha: number }
  | { type: 'dots'; dots: number[]; alpha: number };

/** Уровень спектра в точке `u` (0 — бас, 1 — верх): плавно между соседними полосами. */
export function spectrumAt(levels: number[], u: number): number {
  const n = levels.length;
  if (n === 0) return 0;
  const f = clamp01(u) * n - 0.5;
  const i = Math.floor(f);
  const r = f - i;
  const a = levels[Math.max(0, Math.min(n - 1, i))] ?? 0;
  const b = levels[Math.max(0, Math.min(n - 1, i + 1))] ?? 0;
  return a + (b - a) * r * r * (3 - 2 * r);
}

/** Непрозрачность — к одной из `steps` ступеней между `min` и `max`: одинаковые ступени рисуются одной группой. */
function alphaStep(a: number, min: number, max: number, steps: number): number {
  const k = Math.round(clamp01((a - min) / (max - min)) * (steps - 1));
  return Math.round((min + ((max - min) * k) / (steps - 1)) * 1000) / 1000;
}

/** Мягкий предел: размах `v` не выходит за `room`, сильный удар упирается в край плавно. */
const soft = (v: number, room: number): number => (room > 0 ? room * Math.tanh(v / room) : 0);

function wavesShapes(levels: number[], t: number, o: WaveShapeOptions): WaveShape[] {
  const lines = waveLines(levels, t, { width: o.width, height: o.height, step: o.step ?? (o.width > 1600 ? 10 : 8), punch: o.punch });
  if (!lines.length) return [];
  const dx = lines[0].ys.length > 1 ? o.width / (lines[0].ys.length - 1) : 0;
  const groups = new Map<string, Extract<WaveShape, { type: 'stroke' }>>();
  for (const line of lines) {
    const key = `${line.width}|${line.alpha}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { type: 'stroke', paths: [], width: line.width, alpha: line.alpha, screen: true }));
    const path = new Array<number>(line.ys.length * 2);
    for (let i = 0; i < line.ys.length; i++) {
      path[2 * i] = i * dx;
      path[2 * i + 1] = line.ys[i];
    }
    group.paths.push(path);
  }
  return [...groups.values()];
}

/** Квадратики: столбики из квадратных клеток снизу вверх, бас слева; верхние клетки ярче. */
function blocksShapes(levels: number[], t: number, o: WaveShapeOptions): WaveShape[] {
  const { width, height } = o;
  const punch = clamp01(o.punch ?? 0);
  const pitch = Math.max(12, Math.min(28, width / 40));
  const gap = Math.max(2, Math.round(pitch * 0.2));
  const cell = pitch - gap;
  const cols = Math.floor((width + gap) / pitch);
  const rows = Math.floor((height + gap) / pitch);
  if (cols < 1 || rows < 1) return [];
  const left = (width - (cols * pitch - gap)) / 2;
  const bottom = height - (height - (rows * pitch - gap)) / 2;
  const groups = new Map<number, number[]>();
  for (let c = 0; c < cols; c++) {
    const u = (c + 0.5) / cols;
    const kick = u < 0.35 ? punch * 0.35 * (1 - u / 0.35) : 0;
    const level = clamp01(spectrumAt(levels, u) * (0.88 + 0.12 * Math.sin(t * 3.1 + c * 1.7)) + kick);
    const lit = Math.max(1, Math.round(level * rows));
    const x = left + c * pitch;
    for (let r = 0; r < lit; r++) {
      const alpha = alphaStep(0.3 + 0.65 * (rows > 1 ? r / (rows - 1) : 1), 0.3, 0.95, 4);
      let rects = groups.get(alpha);
      if (!rects) groups.set(alpha, (rects = []));
      rects.push(x, bottom - (r + 1) * pitch + gap, cell, cell);
    }
  }
  return [...groups.entries()].map(([alpha, rects]) => ({ type: 'rects', rects, alpha }));
}

/** Точки: столбцы точек от середины; громче — точки крупнее, ярче и дальше от середины. */
function dotsShapes(levels: number[], t: number, o: WaveShapeOptions): WaveShape[] {
  const { width, height } = o;
  const punch = clamp01(o.punch ?? 0);
  const cols = Math.max(16, Math.min(120, Math.round(width / 16)));
  const PER_COL = 6;
  const grow = Math.max(1, height / 240);
  const margin = 12 * grow;
  const mid = height / 2;
  const groups = new Map<number, number[]>();
  for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1);
    const level = spectrumAt(levels, u);
    const x = margin + u * (width - 2 * margin);
    const alpha = alphaStep(0.25 + level * 0.75, 0.25, 1, 4);
    let dots = groups.get(alpha);
    if (!dots) groups.set(alpha, (dots = []));
    for (let k = 0; k < PER_COL; k++) {
      const side = k - (PER_COL - 1) / 2;
      const r = (1 + level * 2.6 * (1 - Math.abs(side) / PER_COL)) * grow;
      const off = side * height * 0.09 * (0.3 + level * 1.4 + punch * 0.4) + Math.sin(t * 2 + c * 0.4 + k) * 2 * grow;
      const y = Math.max(r, Math.min(height - r, mid + off));
      dots.push(x, y, r);
    }
  }
  return [...groups.entries()].map(([alpha, dots]) => ({ type: 'dots', dots, alpha }));
}

/** Зеркальная волна: спектр от середины вверх и вниз (бас в центре ширины), лёгкая заливка и контур. */
function mirrorShapes(levels: number[], t: number, o: WaveShapeOptions): WaveShape[] {
  const { width, height } = o;
  const punch = clamp01(o.punch ?? 0);
  const mid = height / 2;
  const room = Math.max(0, mid - 1);
  const step = 6;
  const n = Math.floor(width / step) + 1;
  const dx = n > 1 ? width / (n - 1) : 0;
  const top: number[] = [];
  const bottom: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * dx;
    const u = x / width;
    const d = Math.abs(2 * u - 1);
    const env = Math.cos((d * Math.PI) / 2);
    const s = spectrumAt(levels, d) * (0.9 + 0.1 * Math.sin(t * 2.2 + u * 9));
    const amp = soft(height * 0.42 * env * (0.1 + s * 0.95 + punch * 0.25), room);
    top.push(x, mid - amp);
    bottom.push(x, mid + amp);
  }
  const outline: number[] = [...top];
  for (let i = bottom.length - 2; i >= 0; i -= 2) outline.push(bottom[i], bottom[i + 1]);
  return [
    { type: 'fill', paths: [outline], alpha: 0.16 },
    { type: 'stroke', paths: [top, bottom], width: 1.2, alpha: 0.9 },
  ];
}

/** Кольцо: три контура вокруг центра; бас — по бокам, верх — сверху и снизу; удар раздувает кольцо. */
function ringShapes(levels: number[], t: number, o: WaveShapeOptions): WaveShape[] {
  const { width, height } = o;
  const punch = clamp01(o.punch ?? 0);
  const ring = o.ring ?? { x: width / 2, y: height / 2, radius: Math.min(width, height) * 0.24 };
  const r0 = ring.radius * (1 + punch * 0.1);
  const amp = ring.radius * 0.9 * (1 + punch * 0.3);
  const gap = ring.radius * 0.06;
  // Не выходит за холст, если центр внутри него (иначе — без предела).
  const edge = Math.min(ring.x, ring.y, width - ring.x, height - ring.y) - 1;
  const room = edge - ring.radius;
  const POINTS = 128;
  const shapes: WaveShape[] = [];
  for (let k = 0; k < 3; k++) {
    const path = new Array<number>((POINTS + 1) * 2);
    for (let i = 0; i <= POINTS; i++) {
      const ang = (i / POINTS) * Math.PI * 2;
      const s = Math.sin(ang);
      const u = s * s;
      const extra = r0 - ring.radius + k * gap + spectrumAt(levels, u) * amp * (1 - k * 0.22) * (0.6 + 0.4 * Math.sin(t * 2 + i * 0.3 + k));
      const rr = ring.radius + (room > 0 ? soft(extra, room) : extra);
      path[2 * i] = ring.x + Math.cos(ang) * rr;
      path[2 * i + 1] = ring.y + s * rr;
    }
    shapes.push({ type: 'stroke', paths: [path], width: k === 0 ? 1.2 : 0.8, alpha: 0.9 - k * 0.28 });
  }
  return shapes;
}

/** Осциллограф: одна яркая живая линия (и мягкий ореол той же линией потолще и бледнее). */
function scopeShapes(levels: number[], t: number, o: WaveShapeOptions): WaveShape[] {
  const { width, height } = o;
  const punch = clamp01(o.punch ?? 0);
  const mid = height / 2;
  const room = Math.max(0, mid - 3);
  const energy = levels.length ? levels.reduce((s, v) => s + v, 0) / levels.length : 0;
  const amp = height * 0.38 * (0.04 + energy * 0.8 + punch * 0.5);
  const bass = levels[1] ?? 0;
  const high = levels[4] ?? 0;
  const step = 3;
  const n = Math.floor(width / step) + 1;
  const dx = n > 1 ? width / (n - 1) : 0;
  const path = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    const u = (i * dx) / width;
    const wave =
      Math.sin(u * 22 + t * 9) * 0.5 + Math.sin(u * 57 + t * 13) * (0.15 + bass) * 0.4 + Math.sin(u * 131 + t * 21) * (0.15 + high) * 0.3;
    path[2 * i] = i * dx;
    path[2 * i + 1] = mid + soft(amp * wave, room);
  }
  return [
    { type: 'stroke', paths: [path], width: 5, alpha: 0.16 },
    { type: 'stroke', paths: [path], width: 1.4, alpha: 0.95 },
  ];
}

const STYLE_SHAPES: Record<SoundwaveStyle, (levels: number[], t: number, o: WaveShapeOptions) => WaveShape[]> = {
  waves: wavesShapes,
  blocks: blocksShapes,
  dots: dotsShapes,
  mirror: mirrorShapes,
  ring: ringShapes,
  scope: scopeShapes,
};

/** Кадр вида `style`: зависит только от уровней полос, толчка, времени `t` (секунды) и размеров. */
export function waveShapes(style: SoundwaveStyle, levels: number[], t: number, opts: WaveShapeOptions): WaveShape[] {
  if (opts.width <= 0 || opts.height <= 0) return [];
  return (STYLE_SHAPES[style] ?? wavesShapes)(levels, t, opts);
}

// --- Звук для превью в настройках, когда ничего не играет ---

/** Ровный спектр демо-бита, дБ по полосам: бас громче всего, верх тише. */
const DEMO_DB = [-34, -36, -40, -44, -50, -56];
const DEMO_BEAT_SEC = 60 / 140;

/**
 * Сырые уровни полос (как `bandLevels`) выдуманного бита 140 BPM: бочка на каждую долю, малый на 2 и 4,
 * хэт между долями. Превью видов прогоняют их через ту же `stepWaveDynamics`, что и настоящий звук.
 */
export function demoBands(t: number): number[] {
  const ph = (((t % DEMO_BEAT_SEC) + DEMO_BEAT_SEC) % DEMO_BEAT_SEC) / DEMO_BEAT_SEC;
  const half = (ph + 0.5) % 1;
  const beat = Math.floor(t / DEMO_BEAT_SEC);
  const kick = 12 * Math.exp(-ph * 9);
  const snare = beat % 2 === 1 ? 10 * Math.exp(-ph * 7) : 0;
  const hat = 8 * Math.exp(-half * 14);
  return DEMO_DB.map((db, k) => {
    const v = db + 3 * Math.sin(t * 0.7 + k * 1.3) + (k < 2 ? kick : 0) + (k === 2 || k === 3 ? snare : 0) + (k === 5 ? hat : 0);
    return clamp01((v - ANALYSER_MIN_DB) / (ANALYSER_MAX_DB - ANALYSER_MIN_DB));
  });
}
