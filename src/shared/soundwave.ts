// Саундвейв на фоне окна — чистая математика кадра, без DOM (рисует `components/Soundwave`).
// Частоты анализатора → уровни полос по логарифму частоты → автоусиление по скользящему пику и
// огибающая (рост — в тот же кадр, спад — ~200 мс) + детектор удара (толчок волнам) → огибающая из
// «горбов» по ширине окна; поверх неё — пучок тонких синусоид с разной частотой и фазой (как на
// референсе: много наложенных линий, ярче несколько «сердцевинных»). Тишина — едва заметный дрейф.

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
