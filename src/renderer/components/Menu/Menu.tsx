// Общее всплывающее меню действий: «⋯» в строке таблицы треков, на странице артиста.
// Портал поверх интерфейса, позиция от кнопки; закрывается по Esc, клику снаружи, прокрутке и смене размера окна;
// стрелки переходят по пунктам. Образец — меню плейлистов (`AddToPlaylistMenu`).
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../Button/Button';
import styles from './Menu.module.css';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** «Отрицательное» действие — красным. */
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

export interface MenuTriggerState {
  open: boolean;
  toggle(): void;
}

interface MenuProps {
  /** Подпись меню для экранных дикторов. */
  label: string;
  items: MenuItem[];
  renderTrigger(state: MenuTriggerState): ReactNode;
  width?: number;
}

const EDGE_GAP = 12;
const ANCHOR_GAP = 6;
const ITEM_HEIGHT = 42;
/** Атрибут корня меню: по нему клики и прокрутка внутри меню отличаются от внешних. */
const MENU_ATTR = 'data-aura-menu';

interface Position {
  left: number;
  top?: number;
  bottom?: number;
}

function computePosition(anchor: DOMRect, width: number, count: number): Position {
  const left = Math.min(Math.max(EDGE_GAP, anchor.right - width), window.innerWidth - width - EDGE_GAP);
  const height = count * ITEM_HEIGHT + 12;
  const below = window.innerHeight - anchor.bottom - ANCHOR_GAP - EDGE_GAP;
  // Снизу не помещается, а сверху места больше — раскрываем вверх.
  if (below < height && anchor.top > below) return { left, bottom: window.innerHeight - anchor.top + ANCHOR_GAP };
  return { left, top: anchor.bottom + ANCHOR_GAP };
}

const insideMenu = (target: EventTarget | null): boolean => target instanceof Element && target.closest(`[${MENU_ATTR}]`) !== null;

interface PopupProps {
  label: string;
  items: MenuItem[];
  position: Position;
  width: number;
  onClose(): void;
}

function Popup({ label, items, position, width, onClose }: PopupProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Первый пункт получает фокус сразу — меню работает с клавиатуры.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Портал: клавиши всплывают по дереву React к строке таблицы — Enter в меню не должен включать трек.
    e.stopPropagation();
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (list.length === 0) return;
    e.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at <= 0 ? list.length : at) - 1;
    list[next].focus();
  };

  const style: CSSProperties = { left: position.left, top: position.top, bottom: position.bottom, width };

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={style}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      {...{ [MENU_ATTR]: '' }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={[styles.item, item.danger ? styles.danger : ''].join(' ')}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {Icon && <Icon size={17} className={styles.icon} />}
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Меню действий: кнопку рисует `renderTrigger`, пункты — `items`. */
export function Menu({ label, items, renderTrigger, width = 248 }: MenuProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const open = position !== null;
  const count = items.length;

  const close = useCallback(() => setPosition(null), []);
  const toggle = useCallback(() => {
    setPosition((current) => {
      if (current || !anchorRef.current) return null;
      return computePosition(anchorRef.current.getBoundingClientRect(), width, count);
    });
  }, [width, count]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (insideMenu(e.target) || anchorRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      anchorRef.current?.querySelector('button')?.focus();
    };
    const onScroll = (e: Event) => {
      if (!insideMenu(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, close]);

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {renderTrigger({ open, toggle })}
      </span>
      {position && <Popup label={label} items={items} position={position} width={width} onClose={close} />}
    </>
  );
}

interface MoreMenuButtonProps {
  label: string;
  items: MenuItem[];
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

/** Круглая кнопка «⋯» с меню. */
export function MoreMenuButton({ label, items, size = 'small', className }: MoreMenuButtonProps) {
  return (
    <Menu
      label={label}
      items={items}
      renderTrigger={({ open, toggle }) => (
        <IconButton
          icon={MoreHorizontal}
          size={size}
          label={label}
          active={open}
          aria-haspopup="menu"
          aria-expanded={open}
          className={className}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        />
      )}
    />
  );
}
