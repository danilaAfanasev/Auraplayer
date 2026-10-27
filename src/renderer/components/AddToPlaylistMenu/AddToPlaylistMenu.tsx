import { Check, ListMusic, ListPlus, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatTrackCount } from '../../../shared/format';
import type { Playlist, Track } from '../../../shared/types';
import { useLibrary } from '../../stores/useLibrary';
import { useUi } from '../../stores/useUi';
import { IconButton } from '../Button/Button';
import styles from './AddToPlaylistMenu.module.css';

const MENU_WIDTH = 272;
const MENU_MAX_HEIGHT = 360;
const EDGE_GAP = 12;
const ANCHOR_GAP = 6;
/** Атрибут корня меню: по нему клики и прокрутка внутри меню отличаются от внешних. */
const MENU_ATTR = 'data-add-to-playlist-menu';

export interface TriggerState {
  open: boolean;
  /** Открывает или закрывает меню. */
  toggle(): void;
}

interface MenuProps {
  /** Что добавить: один трек или целая подборка. */
  tracks: Track[];
  /** Рисует кнопку, открывающую меню. */
  renderTrigger(state: TriggerState): ReactNode;
}

interface Position {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

function computePosition(anchor: DOMRect): Position {
  const left = Math.min(Math.max(EDGE_GAP, anchor.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - EDGE_GAP);
  const below = window.innerHeight - anchor.bottom - ANCHOR_GAP - EDGE_GAP;
  const above = anchor.top - ANCHOR_GAP - EDGE_GAP;
  // Снизу тесно, а сверху места больше — раскрываем вверх.
  if (below < 240 && above > below) {
    return { left, bottom: window.innerHeight - anchor.top + ANCHOR_GAP, maxHeight: Math.min(MENU_MAX_HEIGHT, above) };
  }
  return { left, top: anchor.bottom + ANCHOR_GAP, maxHeight: Math.min(MENU_MAX_HEIGHT, below) };
}

/** Добавляет `tracks` в плейлист и говорит об итоге уведомлением. */
function addAndReport(playlist: Playlist, tracks: Track[], created: boolean): void {
  const lib = useLibrary.getState();
  const ui = useUi.getState();
  let added = 0;
  for (const track of tracks) if (lib.addToPlaylist(playlist.id, track)) added++;
  const open = { label: 'Открыть', run: () => ui.navigate({ name: 'playlist', param: playlist.id }) };

  if (added === 0) {
    ui.toast('Уже в плейлисте', open);
  } else if (tracks.length === 1) {
    ui.toast(created ? `Плейлист «${playlist.name}» создан, трек добавлен` : `Добавлено в «${playlist.name}»`, open);
  } else if (added === tracks.length) {
    ui.toast(`Добавлено ${formatTrackCount(added)} в «${playlist.name}»`, open);
  } else {
    ui.toast(`Добавлено ${added} из ${tracks.length} — остальные уже в «${playlist.name}»`, open);
  }
}

function Menu({ tracks, position, onClose }: { tracks: Track[]; position: Position; onClose(): void }) {
  const playlists = useLibrary((s) => s.lib.playlists);
  const [creating, setCreating] = useState(playlists.length === 0);
  const [name, setName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Первый пункт (или поле имени) получает фокус сразу, чтобы меню работало с клавиатуры.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('input, [role="menuitem"]')?.focus();
  }, []);

  const choose = (playlist: Playlist) => {
    addAndReport(playlist, tracks, false);
    onClose();
  };

  const create = () => {
    const playlist = useLibrary.getState().createPlaylist(name);
    addAndReport(playlist, tracks, true);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length : at) - 1;
    items[next].focus();
  };

  const style: CSSProperties = {
    left: position.left,
    top: position.top,
    bottom: position.bottom,
    width: MENU_WIDTH,
    maxHeight: position.maxHeight,
  };
  const title =
    tracks.length === 1
      ? 'Добавить в плейлист'
      : `Добавить ${formatTrackCount(tracks.length)}`;

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label={title}
      className={styles.menu}
      style={style}
      onKeyDown={onKeyDown}
      // Портал: события всплывают к строке таблицы — двойной клик по меню не должен запускать трек.
      onDoubleClick={(e) => e.stopPropagation()}
      {...{ [MENU_ATTR]: '' }}
    >
      <div className={styles.head}>{title}</div>
      {playlists.length > 0 && (
        <div className={styles.list}>
          {playlists.map((p) => {
            const has = tracks.length > 0 && tracks.every((t) => p.trackIds.includes(t.id));
            return (
              <button key={p.id} type="button" role="menuitem" className={styles.item} onClick={() => choose(p)}>
                <ListMusic size={17} className={styles.itemIcon} />
                <span className={styles.itemName}>{p.name}</span>
                {has ? (
                  <Check size={15} className={styles.has} aria-label="Уже в плейлисте" />
                ) : (
                  <span className={styles.count}>{p.trackIds.length}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.footer}>
        {creating ? (
          <div className={styles.create}>
            <input
              value={name}
              maxLength={80}
              placeholder="Название плейлиста"
              aria-label="Название нового плейлиста"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
            />
            <button type="button" className={styles.createButton} onClick={create}>
              Создать
            </button>
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            className={[styles.item, styles.newItem].join(' ')}
            onClick={() => setCreating(true)}
          >
            <span className={styles.plus}>
              <Plus size={14} strokeWidth={2.6} />
            </span>
            <span className={styles.itemName}>Новый плейлист</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

const insideMenu = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(`[${MENU_ATTR}]`) !== null;

/**
 * Меню выбора плейлиста для одного трека или подборки. Кнопку рисует `renderTrigger`;
 * меню всплывает над интерфейсом и закрывается по Esc, клику снаружи, прокрутке и смене размера окна.
 */
export function AddToPlaylistMenu({ tracks, renderTrigger }: MenuProps) {
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
      {position && <Menu tracks={tracks} position={position} onClose={close} />}
    </>
  );
}

interface ButtonProps {
  track: Track | null;
  size?: 'small' | 'medium' | 'large';
  /** `plus` — «+» в строках и у обложки, `list` — иконка «добавить в плейлист» в панели плеера. */
  icon?: 'plus' | 'list';
  className?: string;
}

/** Круглая кнопка «+» с меню плейлистов для одного трека. */
export function AddToPlaylistButton({ track, size = 'small', icon = 'plus', className }: ButtonProps) {
  return (
    <AddToPlaylistMenu
      tracks={track ? [track] : []}
      renderTrigger={({ open, toggle }) => (
        <IconButton
          icon={icon === 'plus' ? Plus : ListPlus}
          size={size}
          label="Добавить в плейлист"
          active={open}
          disabled={!track}
          aria-haspopup="menu"
          aria-expanded={open}
          className={className}
          onClick={toggle}
        />
      )}
    />
  );
}
