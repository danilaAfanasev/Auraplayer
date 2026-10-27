import { SlidersVertical } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { IconButton } from '../Button/Button';
import { EqPanel, eqStatusText } from './EqPanel';
import styles from './Equalizer.module.css';

const POPOVER_WIDTH = 420;
const EDGE_GAP = 12;
const ANCHOR_GAP = 8;
/** Атрибут корня окошка: клики внутри него не закрывают окошко. */
const POPOVER_ATTR = 'data-eq-popover';
/** Отступ раздела от верха при переходе «Все настройки →»: под заголовком окна. */
const SCROLL_GAP = 56;

interface Position {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Окошко над кнопкой (панель плеера внизу), по центру кнопки, не вылезая за края окна. */
function computePosition(anchor: DOMRect): Position {
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - EDGE_GAP * 2);
  const left = Math.min(Math.max(EDGE_GAP, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - EDGE_GAP);
  const above = anchor.top - ANCHOR_GAP - EDGE_GAP;
  const below = window.innerHeight - anchor.bottom - ANCHOR_GAP - EDGE_GAP;
  if (above >= below) return { left, bottom: window.innerHeight - anchor.top + ANCHOR_GAP, maxHeight: above };
  return { left, top: anchor.bottom + ANCHOR_GAP, maxHeight: below };
}

const insidePopover = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(`[${POPOVER_ATTR}]`) !== null;

/** Открыть раздел «Эквалайзер» в настройках (якорь `settings-equalizer`). */
export function openEqualizerSettings(): void {
  useUi.getState().navigate({ name: 'settings' });
  // Экран настроек рисуется на следующем кадре — тогда и прокручиваем к разделу (с отступом под заголовок окна).
  const scroll = (tries: number): void => {
    const el = document.getElementById('settings-equalizer');
    if (!el) {
      if (tries > 0) requestAnimationFrame(() => scroll(tries - 1));
      return;
    }
    let host = el.parentElement;
    while (host && !(host.scrollHeight > host.clientHeight && getComputedStyle(host).overflowY !== 'visible')) host = host.parentElement;
    if (!host) return el.scrollIntoView({ block: 'start' });
    const top = host.scrollTop + el.getBoundingClientRect().top - host.getBoundingClientRect().top - SCROLL_GAP;
    host.scrollTo({ top, behavior: 'smooth' });
  };
  requestAnimationFrame(() => scroll(10));
}

/**
 * Кнопка эквалайзера в панели плеера (после «Волны»): подсвечена, пока эквалайзер включён.
 * Нажатие открывает окошко над кнопкой; закрывается Esc, кликом мимо, повторным нажатием.
 */
export function EqButton({ size = 'medium' }: { size?: 'small' | 'medium' | 'large' }) {
  const eq = useSettings((s) => s.settings.equalizer);
  const [position, setPosition] = useState<Position | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const open = position !== null;

  const close = useCallback(() => setPosition(null), []);
  const toggle = useCallback(() => {
    setPosition((current) => {
      if (current || !anchorRef.current) return null;
      return computePosition(anchorRef.current.getBoundingClientRect());
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (insidePopover(e.target) || anchorRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      anchorRef.current?.querySelector('button')?.focus();
    };
    const onResize = () => close();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [open, close]);

  const style: CSSProperties | undefined = position
    ? { left: position.left, top: position.top, bottom: position.bottom, maxHeight: position.maxHeight, width: Math.min(POPOVER_WIDTH, window.innerWidth - EDGE_GAP * 2) }
    : undefined;

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        <IconButton
          icon={SlidersVertical}
          size={size}
          label={`Эквалайзер — ${eqStatusText(eq).toLowerCase()}`}
          active={eq.enabled}
          toggle
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        />
      </span>
      {position &&
        createPortal(
          <div className={styles.popover} style={style} role="dialog" aria-label="Эквалайзер" {...{ [POPOVER_ATTR]: '' }}>
            <EqPanel
              size="popover"
              onOpenSettings={() => {
                close();
                openEqualizerSettings();
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
