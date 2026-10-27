import { useEffect, useRef } from 'react';
import { bandLevels, createWaveDynamics, stepWaveDynamics, type WaveDynamics, waveLines } from '../../../shared/soundwave';
import { getAnalyser } from '../../audioGraph';
import { selectCurrentTrack, usePlayer } from '../../stores/usePlayer';
import styles from './Soundwave.module.css';

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
/** Плотность пикселей холста: тонким линиям хватает 1,5, больше — лишняя работа. */
const MAX_DPR = 1.5;
/** «Уменьшить движение»: один неподвижный кадр с умеренной волной. */
const STATIC_LEVELS = [0.35, 0.55, 0.3, 0.6, 0.4, 0.25];
const STATIC_T = 7.3;

const reducedMotion = (): MediaQueryList => window.matchMedia('(prefers-reduced-motion: reduce)');
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
 * Саундвейв на фоне всего окна: тонкие наложенные волны в цвет акцента темы, движутся от звука
 * (анализатор звукового графа). Пока играет — кадр на каждый кадр экрана (`requestAnimationFrame`),
 * удар виден в тот же кадр; пауза — тихий дрейф редкими кадрами; окно скрыто — не рисует;
 * «уменьшить движение» — один неподвижный кадр. Пока компонент на месте, `<html data-soundwave>`
 * делает панели полупрозрачными.
 */
export function Soundwave() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const root = document.documentElement;
    root.dataset.soundwave = '';

    let color = accentColor();
    let dyn = createWaveDynamics();
    let freq: Uint8Array<ArrayBuffer> | null = null;
    let t = 0;
    let speed = SPEED_IDLE;
    let last = 0;
    let active = false;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Линии с одинаковыми толщиной и непрозрачностью — одним штрихом (`Path2D`): несколько вызовов
    // рисования на кадр вместо двух десятков. Толщина — в пикселях экрана и не больше одного: штрих толще
    // пикселя по пути с самопересечениями видеокарта считает в разы дольше (замер: ×2,5 на кадр).
    const draw = (levels: number[], time: number, punch: number): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const lines = waveLines(levels, time, { width, height, step: width > 1600 ? 10 : 8, punch });
      if (!lines.length) return;
      const step = width / (lines[0].ys.length - 1);
      const groups = new Map<string, { path: Path2D; width: number; alpha: number }>();
      for (const line of lines) {
        const key = `${line.width}|${line.alpha}`;
        let group = groups.get(key);
        if (!group) groups.set(key, (group = { path: new Path2D(), width: line.width, alpha: line.alpha }));
        group.path.moveTo(0, line.ys[0]);
        for (let i = 1; i < line.ys.length; i++) group.path.lineTo(i * step, line.ys[i]);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = color;
      for (const group of groups.values()) {
        ctx.globalAlpha = group.alpha;
        ctx.lineWidth = Math.min(1, group.width) / dpr;
        ctx.stroke(group.path);
      }
      ctx.globalAlpha = 1;
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

    const playing = (): boolean => usePlayer.getState().isPlaying;

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
      if (analyser) {
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
      if (active || document.hidden || reducedMotion().matches) return;
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
    const redrawIfStill = (): void => {
      if (!active && reducedMotion().matches) drawStatic();
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
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      if (active) draw(dyn.levels, t, dyn.punch);
      else redrawIfStill();
    };

    // Тема меняется переменными на <html> — перекрашиваем сразу (и посреди анимации смены темы).
    const themeObserver = new MutationObserver(() => {
      const next = accentColor();
      if (next === color) return;
      color = next;
      if (active) draw(dyn.levels, t, dyn.punch);
      else redrawIfStill();
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

    return () => {
      stop();
      unsubscribe();
      themeObserver.disconnect();
      sizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', onMotion);
      delete root.dataset.soundwave;
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
