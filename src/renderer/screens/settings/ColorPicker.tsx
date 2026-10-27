import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { hexToHsv, hsvToHex, normalizeHex } from '../../theme/colorMath';
import type { ThemeOrigin } from '../../theme/themeTransition';
import styles from './ColorPicker.module.css';

interface Props {
  label: string;
  /** Цвет, который сейчас показан (в том числе черновик во время перетаскивания). */
  value: string;
  /** Живой предпросмотр: вызывается на каждый шаг перетаскивания и при вводе валидного hex. */
  onPreview(hex: string): void;
  /** Подтверждение (отпустили ползунок, Enter или уход из поля hex) с точкой для анимации заливки. */
  onCommit(hex: string, origin: ThemeOrigin): void;
}

type Hsv = [number, number, number];

const center = (el: HTMLElement): ThemeOrigin => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const POPOVER_W = 248;
const POPOVER_H = 212;
const EDGE = 12;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Образец цвета + поле hex + всплывающая палитра (поле насыщенности/яркости и полоса оттенка). */
export function ColorPicker({ label, value, onPreview, onCommit }: Props) {
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<CSSProperties>({});
  const [open, setOpen] = useState(false);
  const [hsv, setHsvState] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const hsvRef = useRef(hsv);

  const setHsv = useCallback((next: Hsv) => {
    hsvRef.current = next;
    setHsvState(next);
  }, []);

  // Внешнее значение сменилось (выбрали пресет, «Сбросить») — подтягиваем палитру. Если значение
  // совпадает с текущим выбором, оттенок (он теряется у серых цветов) не трогаем.
  useEffect(() => {
    if (hsvToHex(...hsvRef.current) !== value) setHsv(hexToHsv(value));
    // Пока человек печатает в поле hex, его текст не перезаписываем.
    if (document.activeElement !== hexRef.current) setText(value);
  }, [value, setHsv]);

  // Палитра рисуется поверх всего окна (портал), поэтому её не обрезает ни прокрутка экрана, ни панель плеера:
  // открывается под образцом, а если внизу нет места — над ним.
  const place = useCallback(() => {
    const r = swatchRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.bottom + 8;
    const top = below + POPOVER_H > window.innerHeight - EDGE ? Math.max(EDGE, r.top - 8 - POPOVER_H) : below;
    const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - POPOVER_W - EDGE);
    setPopoverPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Закрытие по клику снаружи и по Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.PointerEvent): void => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const move = (e: PointerEvent<HTMLDivElement>, kind: 'sv' | 'hue'): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = clamp01((e.clientX - rect.left) / rect.width);
    const [h, s, v] = hsvRef.current;
    const next: Hsv = kind === 'hue' ? [px * 360, s, v] : [h, px, 1 - clamp01((e.clientY - rect.top) / rect.height)];
    setHsv(next);
    onPreview(hsvToHex(...next));
  };

  const drag = (kind: 'sv' | 'hue') => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e, kind);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e, kind);
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      onCommit(hsvToHex(...hsvRef.current), { x: e.clientX, y: e.clientY });
    },
  });

  const onText = (raw: string): void => {
    setText(raw);
    const hex = normalizeHex(raw);
    if (hex) {
      setHsv(hexToHsv(hex));
      onPreview(hex);
    }
  };

  const commitText = (): void => {
    const hex = normalizeHex(text);
    if (!hex) {
      setText(value);
      return;
    }
    setText(hex);
    onCommit(hex, hexRef.current ? center(hexRef.current) : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
  };

  const onTextKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commitText();
  };

  const invalid = normalizeHex(text) === null;
  const [h, s, v] = hsv;

  const popover = open ? (
    <div className={styles.popover} role="dialog" aria-label={`${label}: палитра`} ref={popoverRef} style={popoverPos}>
      {/* Спектр палитры (оттенок, насыщенность, яркость) — единственное место, где цвета заданы напрямую. */}
      <div
        className={styles.sv}
        style={{
          background: `linear-gradient(to top, hsl(0 0% 0%), transparent), linear-gradient(to right, hsl(0 0% 100%), hsl(${h} 100% 50%))`,
        }}
        {...drag('sv')}
      >
        <span className={styles.svThumb} style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <div className={styles.hue} {...drag('hue')}>
        <span className={styles.hueThumb} style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h} 100% 50%)` }} />
      </div>
    </div>
  ) : null;

  return (
    <div className={styles.picker} ref={rootRef}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div className={styles.row}>
        <button
          type="button"
          ref={swatchRef}
          className={styles.swatch}
          style={{ background: value }}
          aria-label={`${label}: выбрать цвет`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
        <input
          id={inputId}
          ref={hexRef}
          className={[styles.hex, invalid ? styles.invalid : ''].filter(Boolean).join(' ')}
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid}
          onChange={(e) => onText(e.target.value)}
          onBlur={commitText}
          onKeyDown={onTextKey}
        />
      </div>
      {popover && createPortal(popover, document.body)}
    </div>
  );
}
