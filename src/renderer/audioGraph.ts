// Звуковой граф страницы — единственный владелец AudioContext. Оба <audio> движка (играющий и
// предзагрузочный, они меняются ролями) подключены к одной цепочке:
//   MediaElementSource ×2 → предусиление → 10 фильтров эквалайзера → анализатор (саундвейв) → выход.
// Громкость и mute остаются на самих элементах (действуют до графа). Источник на элемент создаётся
// один раз и навсегда: после этого звук элемента идёт только через граф, поэтому выключенный
// эквалайзер — это нулевые усиления, а не отключение узлов. Граф создаётся при первом воспроизведении
// (политика автозапуска звука); до него элементы играют напрямую.
import { EQ_BANDS_HZ } from '../shared/equalizer';
import { ANALYSER_MAX_DB, ANALYSER_MIN_DB } from '../shared/soundwave';
import { initEqualizerSync } from './stores/equalizerSync';

/** Сглаживание анализатора между кадрами (0 — нет): почти выключено, чтобы волна не запаздывала. */
const ANALYSER_SMOOTHING = 0.25;

/** Постоянная времени плавной смены усиления: ~30 мс до цели, без щелчков. */
const GAIN_TIME_CONSTANT_SEC = 0.01;
/** Добротность средних полос: соседние полосы на октаву друг от друга. */
const BAND_Q = 1.4;

interface Graph {
  ctx: AudioContext;
  preamp: GainNode;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
}

let graph: Graph | null = null;
/** Элементы, ждущие графа (до первого воспроизведения). */
const pending: HTMLAudioElement[] = [];
const attached = new WeakSet<HTMLAudioElement>();
/** Последние усиления — применяются и к графу, созданному позже. */
let current: { preamp: number; gains: number[] } = { preamp: 0, gains: EQ_BANDS_HZ.map(() => 0) };

const dbToGain = (db: number): number => Math.pow(10, db / 20);

function connect(g: Graph, el: HTMLAudioElement): void {
  try {
    g.ctx.createMediaElementSource(el).connect(g.preamp);
  } catch {
    // Источник для элемента уже есть (не должно случаться) — элемент и так в графе.
  }
}

function build(): Graph | null {
  const Ctx = typeof window !== 'undefined' ? window.AudioContext : undefined;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx({ latencyHint: 'playback' });
  } catch {
    return null;
  }
  const preamp = ctx.createGain();
  const filters = EQ_BANDS_HZ.map((hz, i) => {
    const f = ctx.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS_HZ.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = hz;
    if (f.type === 'peaking') f.Q.value = BAND_Q;
    return f;
  });
  // Анализатор для саундвейва: окно 2048 (~43 мс, корзина ~23 Гц — бас различим), сглаживание почти
  // выключено (удар виден в тот же кадр — спад делает сам саундвейв), шкала дБ с запасом сверху.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
  analyser.maxDecibels = ANALYSER_MAX_DB;
  analyser.minDecibels = ANALYSER_MIN_DB;
  let node: AudioNode = preamp;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  node.connect(analyser);
  analyser.connect(ctx.destination);
  return { ctx, preamp, filters, analyser };
}

function applyGains(g: Graph, smooth: boolean): void {
  const t = g.ctx.currentTime;
  const set = (param: AudioParam, value: number) => {
    if (smooth) param.setTargetAtTime(value, t, GAIN_TIME_CONSTANT_SEC);
    else param.value = value;
  };
  set(g.preamp.gain, dbToGain(current.preamp));
  g.filters.forEach((f, i) => set(f.gain, current.gains[i] ?? 0));
}

function ensureGraph(): Graph | null {
  if (graph) return graph;
  graph = build();
  if (!graph) return null;
  applyGains(graph, false);
  for (const el of pending.splice(0)) connect(graph, el);
  initEqualizerSync();
  return graph;
}

/** Регистрирует элемент движка (один раз на элемент; зовёт `audioEngine.create()`). */
export function attachElement(el: HTMLAudioElement): void {
  if (attached.has(el)) return;
  attached.add(el);
  if (graph) connect(graph, el);
  else pending.push(el);
}

/** Из play: создаёт граф при первом воспроизведении и будит приостановленный контекст. */
export function resumeGraph(): void {
  const g = ensureGraph();
  if (g && g.ctx.state === 'suspended') void g.ctx.resume().catch(() => undefined);
}

/** Усиления эквалайзера (дБ); меняются плавно. Выключенный эквалайзер — нули. */
export function setEqualizer(e: { preamp: number; gains: number[] }): void {
  current = { preamp: e.preamp, gains: [...e.gains] };
  if (graph) applyGains(graph, true);
}

/** Анализатор для саундвейва; null — графа ещё нет (ничего не играло). */
export function getAnalyser(): AnalyserNode | null {
  return graph?.analyser ?? null;
}
