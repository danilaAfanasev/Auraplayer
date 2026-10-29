import { useEffect, useRef } from 'react';
import type { SoundwaveStyle } from '../../../shared/types';
import styles from './Soundwave.module.css';
import { startSoundwave, type SoundwaveEngine } from './soundwaveEngine';

/** Превью маленькие: хватает плотности 2 (на 4K-экране линии остаются чёткими), пикселей всё равно мало. */
const PREVIEW_DPR = 2;

/**
 * Маленький саундвейв вида `style` для выбора в «Оформлении»: тот же цикл кадра, что и на фоне окна; пока музыка
 * играет — от её звука, иначе — от выдуманного бита. Рисует, только пока виден на экране (раздел прокручен к нему)
 * и окно не скрыто; «уменьшить движение» — неподвижный кадр. Холст заполняет родителя.
 */
export function SoundwavePreview({ style, className }: { style: SoundwaveStyle; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const styleRef = useRef(style);
  const engine = useRef<SoundwaveEngine | null>(null);
  styleRef.current = style;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const run = startSoundwave({
      canvas,
      source: 'preview',
      maxDpr: PREVIEW_DPR,
      style: () => styleRef.current,
      ring: () => null,
      visible: () => false,
    });
    engine.current = run;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) run.setVisible(entry.isIntersecting);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      run.dispose();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.redraw();
  }, [style]);

  return <canvas ref={canvasRef} className={[styles.preview, className].filter(Boolean).join(' ')} aria-hidden="true" />;
}
