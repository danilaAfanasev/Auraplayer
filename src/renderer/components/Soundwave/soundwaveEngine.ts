// Цикл кадра саундвейва — общий для фона окна, экрана текста и превью видов в настройках.
// Звук → `bandLevels` → задержка на буфер вывода → `stepWaveDynamics` (удар в тот же кадр, автоусиление) →
// `waveShapes(вид, …)` → несколько вызовов рисования на кадр. Геометрия видов — `shared/soundwave.ts`.
import {
  bandLevels,
  createWaveDynamics,
  demoBands,
  stepWaveDynamics,
  type WaveDynamics,
  type WaveRing,
  type WaveShape,
  waveShapes,
} from '../../../shared/soundwave';
import type { SoundwaveStyle } from '../../../shared/types';
import { getAnalyser } from '../../audioGraph';
import { selectCurrentTrack, usePlayer } from '../../stores/usePlayer';

/** Пауза и волна улеглась: дрейф медленный — хватает редких кадров. Пока играет — каждый кадр экрана. */
const FPS_IDLE = 20;
/** Скорость времени волны: играет — 1, пауза — едва движется. */
const SPEED_PLAYING = 1;
const SPEED_IDLE = 0.12;
/** Толчок удара на миг ускоряет бег волн: 1 — вдвое быстрее при полном толчке. */
const PUNCH_TIME = 1.5;
/** Ниже этого уровни и толчок считаются улёгшимися (можно перейти на редкие кадры). */
const SETTLED = 0.01;
/**
 * Анализатор видит звук раньше, чем его слышно: после него ещё буфер выхода (`baseLatency` + `outputLatency`,
 * на Windows ~70 мс). Его окно само запаздывает на ~20 мс — на остаток волна ждёт, чтобы удар совпал со звуком.
 */
const ANALYSIS_DELAY_SEC = 0.02;
const MAX_VISUAL_DELAY_SEC = 0.15;
/** «Уменьшить движение»: один неподвижный кадр с умеренной волной. */
const STATIC_LEVELS = [0.35, 0.55, 0.3, 0.6, 0.4, 0.25];
const STATIC_T = 7.3;

export const reducedMotion = (): MediaQueryList => window.matchMedia('(prefers-reduced-motion: reduce)');
const accentColor = (): string =>
  document.documentElement.style.getPropertyValue('--accent').trim() ||
  getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
  '#8b5cf6';

const settled = (d: WaveDynamics): boolean => d.punch < SETTLED && d.levels.every((v) => v < SETTLED);

/** На сколько мс придержать уровни, чтобы волна не обгоняла звук в колонках. */
function visualDelayMs(analyser: AnalyserNode): number {
  const ctx = analyser.context as Partial<AudioContext>;
  const out = (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0) - ANALYSIS_DELAY_SEC;
  return Math.max(0, Math.min(MAX_VISUAL_DELAY_SEC, out)) * 1000;
}

/**
 * Рисует кадр: каждая группа — один `Path2D` и один вызов `stroke`/`fill`. Толщина «волосков» «Волн» — в пикселях
 * экрана и не больше одного: штрих толще пикселя по пути с самопересечениями видеокарта считает в разы дольше.
 */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: WaveShape[], color: string, dpr: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!shapes.length) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineJoin = 'round';
  for (const shape of shapes) {
    ctx.globalAlpha = shape.alpha;
    const path = new Path2D();
    if (shape.type === 'stroke' || shape.type === 'fill') {
      for (const p of shape.paths) {
        if (p.length < 4) continue;
        path.moveTo(p[0], p[1]);
        for (let i = 2; i + 1 < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
        if (shape.type === 'fill') path.closePath();
      }
      if (shape.type === 'stroke') {
        ctx.lineWidth = shape.screen ? Math.min(1, shape.width) / dpr : shape.width;
        ctx.stroke(path);
      } else ctx.fill(path);
    } else if (shape.type === 'rects') {
      const r = shape.rects;
      for (let i = 0; i + 3 < r.length; i += 4) path.rect(r[i], r[i + 1], r[i + 2], r[i + 3]);
      ctx.fill(path);
    } else {
      const d = shape.dots;
      for (let i = 0; i + 2 < d.length; i += 3) {
        path.moveTo(d[i] + d[i + 2], d[i + 1]);
        path.arc(d[i], d[i + 1], d[i + 2], 0, Math.PI * 2);
      }
      ctx.fill(path);
    }
  }
  ctx.globalAlpha = 1;
}

export interface SoundwaveEngineOptions {
  canvas: HTMLCanvasElement;
  /** `live` — звук плеера; `preview` — звук плеера, пока он играет, иначе выдуманный бит (превью в настройках). */
  source: 'live' | 'preview';
  /** Вид — читается на каждом кадре: смена вида не перезапускает цикл. */
  style(): SoundwaveStyle;
  /** Кольцо в пикселях холста (`null` — по центру холста). */
  ring(): WaveRing | null;
  /** Плотность пикселей холста: тонким линиям хватает 1,5, больше — лишняя работа. */
  maxDpr: number;
  /** Видим ли холст (превью вне экрана не рисуют); по умолчанию — всегда. */
  visible?(): boolean;
}

export interface SoundwaveEngine {
  /** Перерисовать сейчас (сменился вид или кольцо, а кадра ждать долго — пауза, «уменьшить движение»). */
  redraw(): void;
  /** Холст снова виден или скрыт (превью). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Цикл кадра на холсте: пока играет — кадр на каждый кадр экрана (`requestAnimationFrame`), удар виден в тот же
 * кадр; пауза — тихий дрейф редкими кадрами; окно скрыто — не рисует; «уменьшить движение» — один неподвижный кадр.
 */
export function startSoundwave(opts: SoundwaveEngineOptions): SoundwaveEngine {
  const { canvas } = opts;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { redraw: () => undefined, setVisible: () => undefined, dispose: () => undefined };
  const preview = opts.source === 'preview';

  let color = accentColor();
  let dyn = createWaveDynamics();
  let freq: Uint8Array<ArrayBuffer> | null = null;
  let t = 0;
  let speed = SPEED_IDLE;
  let last = 0;
  let active = false;
  let visible = opts.visible?.() ?? true;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  /** Время выдуманного бита превью. */
  let demoT = 0;

  const draw = (levels: number[], time: number, punch: number): void => {
    const ring = opts.ring();
    const shapes = waveShapes(opts.style(), levels, time, {
      width,
      height,
      punch,
      ...(ring ? { ring } : {}),
    });
    drawShapes(ctx, shapes, color, dpr);
  };
  const drawStatic = (): void => draw(STATIC_LEVELS, STATIC_T, 0);

  // Уровни последних кадров: берём те, что сняты `delayMs` назад, — их сейчас и слышно.
  const recent: { at: number; raw: number[] }[] = [];
  const delayed = (now: number, raw: number[], delayMs: number): number[] => {
    recent.push({ at: now, raw });
    let pick = 0;
    while (pick + 1 < recent.length && recent[pick + 1].at <= now - delayMs) pick++;
    recent.splice(0, pick);
    return recent[0].raw;
  };

  const playerPlaying = (): boolean => usePlayer.getState().isPlaying;
  /** Превью без музыки «играет» выдуманный бит. */
  const playing = (): boolean => preview || playerPlaying();

  // Играет (или волна ещё не улеглась) — следующий кадр сразу; пауза — по таймеру с редкой частотой:
  // непрерывный rAF будил бы композитор на частоте экрана, когда смотреть не на что.
  const schedule = (): void => {
    if (playing() || !settled(dyn) || Math.abs(speed - SPEED_IDLE) > 0.01) {
      frame = requestAnimationFrame(tick);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      frame = requestAnimationFrame(tick);
    }, Math.max(0, 1000 / FPS_IDLE - (performance.now() - last)));
  };

  const tick = (now: number): void => {
    frame = 0;
    if (!active) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    speed += ((playing() ? SPEED_PLAYING : SPEED_IDLE) - speed) * Math.min(1, dt * 3);
    const analyser = getAnalyser();
    let raw: number[];
    if (preview && !playerPlaying()) {
      demoT += dt;
      raw = demoBands(demoT);
    } else if (analyser) {
      if (!freq || freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freq);
      raw = delayed(now, bandLevels(freq, analyser.context.sampleRate), visualDelayMs(analyser));
    } else raw = bandLevels(null);
    dyn = stepWaveDynamics(dyn, raw, dt);
    t += dt * speed * (1 + PUNCH_TIME * dyn.punch);
    draw(dyn.levels, t, dyn.punch);
    schedule();
  };

  const start = (): void => {
    if (active || !visible || document.hidden || reducedMotion().matches) return;
    active = true;
    last = 0;
    frame = requestAnimationFrame(tick);
  };
  const stop = (): void => {
    active = false;
    if (frame) cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
    frame = 0;
    timer = null;
  };
  const redraw = (): void => {
    if (active) draw(dyn.levels, t, dyn.punch);
    else if (reducedMotion().matches) drawStatic();
    else if (width > 0) draw(dyn.levels, t, dyn.punch);
  };

  // Нажали «играть», пока ждали редкого кадра паузы, — кадр сразу; сменился трек — автоусиление заново.
  let trackId = selectCurrentTrack(usePlayer.getState())?.id ?? null;
  const unsubscribe = usePlayer.subscribe((s) => {
    const id = selectCurrentTrack(s)?.id ?? null;
    if (id !== trackId) {
      trackId = id;
      dyn = createWaveDynamics();
    }
    if (s.isPlaying && active && timer) {
      clearTimeout(timer);
      timer = null;
      frame = requestAnimationFrame(tick);
    }
  });

  const resize = (): void => {
    dpr = Math.min(opts.maxDpr, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    redraw();
  };

  // Тема меняется переменными на <html> — перекрашиваем сразу (и посреди анимации смены темы).
  const root = document.documentElement;
  const themeObserver = new MutationObserver(() => {
    const next = accentColor();
    if (next === color) return;
    color = next;
    redraw();
  });
  themeObserver.observe(root, { attributes: true, attributeFilter: ['style'] });

  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(canvas);

  const onVisibility = (): void => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);
  const motion = reducedMotion();
  const onMotion = (): void => {
    if (motion.matches) {
      stop();
      drawStatic();
    } else start();
  };
  motion.addEventListener('change', onMotion);

  resize();
  if (motion.matches) drawStatic();
  else start();

  return {
    redraw,
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      if (visible) start();
      else stop();
    },
    dispose() {
      stop();
      unsubscribe();
      themeObserver.disconnect();
      sizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', onMotion);
    },
  };
}
