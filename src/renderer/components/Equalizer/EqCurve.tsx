import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { EQ_BAND_LABELS, EQ_BANDS_HZ, EQ_GAIN_MAX, EQ_GAIN_MIN, setBandGain, type EqualizerSettings } from '../../../shared/equalizer';
import styles from './Equalizer.module.css';
import { bandX, curvePath, gainFromY, gainText, gainToY, keyStep } from './eqGeometry';

interface EqCurveProps {
  eq: EqualizerSettings;
  onChange(next: EqualizerSettings): void;
  size: 'popover' | 'large';
}

/** Ширина и высота SVG в своих единицах (растягивается на всю область). */
const VIEW_W = 1000;
const VIEW_H = 200;

const hzText = (hz: number): string => (hz >= 1000 ? `${hz / 1000} кГц` : `${hz} Гц`);

/**
 * Кривая эквалайзера: 10 точек-ползунков. Точку тянут мышью вверх-вниз (рядом — значение «+4 дБ»),
 * двойной клик — в 0; клавиатура: Tab по точкам, стрелки ±1 дБ, PageUp/PageDown ±3, Home/End — пределы.
 * Клик по пустому месту хватает ближайшую по ширине точку. Выключенный эквалайзер — кривая приглушена,
 * но двигать можно: правка включает его сама (`setBandGain`).
 */
export function EqCurve({ eq, onChange, size }: EqCurveProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const eqRef = useRef(eq);
  eqRef.current = eq;
  const [dragging, setDragging] = useState<number | null>(null);
  /** Точка, на которой нажали последний раз (null — пустое место): двойной клик ставит её в 0. Захват указателя
   *  уводит dblclick на область, поэтому слушаем его там. */
  const pressedPoint = useRef<number | null>(null);

  const setGain = (index: number, gain: number): void => {
    const next = setBandGain(eqRef.current, index, gain);
    if (next.gains[index] !== eqRef.current.gains[index] || next.presetId !== eqRef.current.presetId || !eqRef.current.enabled) onChange(next);
  };

  const gainAt = (clientY: number): number => {
    const rect = areaRef.current?.getBoundingClientRect();
    return rect ? gainFromY(clientY - rect.top, rect.height) : 0;
  };

  const startDrag = (index: number, e: PointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      areaRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Указатель уже отпущен — тянуть нечего, значение всё равно ставится ниже.
    }
    areaRef.current?.querySelector<HTMLElement>(`[data-band="${index}"]`)?.focus();
    setDragging(index);
    setGain(index, gainAt(e.clientY));
  };

  const onAreaPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const index = Math.min(EQ_BANDS_HZ.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * EQ_BANDS_HZ.length)));
    pressedPoint.current = null;
    startDrag(index, e);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging !== null) setGain(dragging, gainAt(e.clientY));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging === null) return;
    if (areaRef.current?.hasPointerCapture(e.pointerId)) areaRef.current.releasePointerCapture(e.pointerId);
    setDragging(null);
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyStep(e.key, eq.gains[index] ?? 0);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setGain(index, next);
  };

  const d = curvePath(eq.gains, VIEW_W, VIEW_H);
  const area = d ? `${d} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z` : '';

  return (
    <div className={[styles.curve, size === 'large' ? styles.curveLarge : '', eq.enabled ? '' : styles.off].filter(Boolean).join(' ')}>
      <div
        ref={areaRef}
        className={styles.curveArea}
        onPointerDown={onAreaPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          if (pressedPoint.current !== null) setGain(pressedPoint.current, 0);
        }}
      >
        <svg className={styles.curveSvg} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
          <line className={styles.zeroLine} x1="0" y1={VIEW_H / 2} x2={VIEW_W} y2={VIEW_H / 2} vectorEffect="non-scaling-stroke" />
          {area && <path className={styles.curveFill} d={area} />}
          {d && <path className={styles.curveLine} d={d} vectorEffect="non-scaling-stroke" />}
        </svg>
        {EQ_BANDS_HZ.map((hz, i) => {
          const gain = eq.gains[i] ?? 0;
          return (
            <div
              key={hz}
              data-band={i}
              role="slider"
              tabIndex={0}
              aria-label={hzText(hz)}
              aria-orientation="vertical"
              aria-valuemin={EQ_GAIN_MIN}
              aria-valuemax={EQ_GAIN_MAX}
              aria-valuenow={gain}
              aria-valuetext={`${hzText(hz)}, ${gainText(gain)}`}
              className={[styles.point, dragging === i ? styles.pointActive : ''].filter(Boolean).join(' ')}
              style={{ left: `${bandX(i)}%`, top: `${gainToY(gain)}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                pressedPoint.current = i;
                startDrag(i, e);
              }}
              onKeyDown={(e) => onKeyDown(i, e)}
            >
              {dragging === i && <span className={styles.pointValue}>{gainText(gain)}</span>}
            </div>
          );
        })}
      </div>
      <div className={styles.bandLabels} aria-hidden="true">
        {EQ_BAND_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
