import { useEffect, useRef } from 'react';
import type { WaveRing } from '../../../shared/soundwave';
import type { SoundwaveStyle } from '../../../shared/types';
import { useSettings } from '../../stores/useSettings';
import styles from './Soundwave.module.css';
import { startSoundwave, type SoundwaveEngine } from './soundwaveEngine';

/** Центр «Кольца» в координатах окна; `radius` — внутренний радиус (вокруг обложки), иначе — по размеру холста. */
export interface SoundwaveCenter {
  x: number;
  y: number;
  radius?: number;
}

/** Плотность пикселей холста: тонким линиям хватает 1,5, больше — лишняя работа. */
const MAX_DPR = 1.5;
/** Кольцо без заданного радиуса — такая доля меньшей стороны холста. */
const RING_SHARE = 0.2;

/**
 * Сколько холстов на фоне сейчас на месте: `<html data-soundwave>` (полупрозрачные панели) снимается с последним.
 * При закрытии экрана текста на миг живут два — слоя и фона окна.
 */
let mounted = 0;

/**
 * Саундвейв на фоне всего окна (и на экране текста): вид из «Оформления» (`Settings.soundwaveStyle`) или `style`,
 * в цвет акцента темы, от звука плеера (анализатор звукового графа). «Кольцо» — холст во всё окно, центр — `center`
 * (по умолчанию — центр холста); остальные виды — полосой по середине высоты. Пока компонент на месте,
 * `<html data-soundwave>` делает панели полупрозрачными.
 */
export function Soundwave({ style, center }: { style?: SoundwaveStyle; center?: SoundwaveCenter | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chosen = useSettings((s) => s.settings.soundwaveStyle);
  const kind = style ?? chosen;
  const kindRef = useRef(kind);
  const centerRef = useRef(center ?? null);
  const engine = useRef<SoundwaveEngine | null>(null);
  /** Место холста в окне: читается не на каждом кадре, а после смены размеров окна и вида. */
  const rectRef = useRef<DOMRect | null>(null);
  kindRef.current = kind;
  centerRef.current = center ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = document.documentElement;
    mounted++;
    root.dataset.soundwave = '';
    const forgetRect = (): void => void (rectRef.current = null);
    window.addEventListener('resize', forgetRect);
    engine.current = startSoundwave({
      canvas,
      source: 'live',
      maxDpr: MAX_DPR,
      style: () => kindRef.current,
      ring: (): WaveRing | null => {
        const c = centerRef.current;
        if (!c) return null;
        const rect = (rectRef.current ??= canvas.getBoundingClientRect());
        return {
          x: c.x - rect.left,
          y: c.y - rect.top,
          radius: c.radius ?? Math.min(rect.width, rect.height) * RING_SHARE,
        };
      },
    });
    return () => {
      window.removeEventListener('resize', forgetRect);
      engine.current?.dispose();
      engine.current = null;
      if (--mounted === 0) delete root.dataset.soundwave;
    };
  }, []);

  // Сменили вид или кольцо сдвинулось — кадр сразу (на паузе следующий был бы через 50 мс, при «уменьшить движение» — никогда).
  useEffect(() => {
    rectRef.current = null;
    engine.current?.redraw();
  }, [kind, center?.x, center?.y, center?.radius]);

  return (
    <canvas
      ref={canvasRef}
      className={[styles.canvas, kind === 'ring' ? styles.full : ''].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
}
