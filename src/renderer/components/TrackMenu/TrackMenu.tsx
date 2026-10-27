// Контекстное меню трека — одно на приложение: правый клик (или клавиша меню / Shift+F10) по строке очереди справа,
// «Недавно» и любой таблицы треков, а также «⋯» в таблице. Открывается у курсора, закрывается по Esc, клику мимо
// и прокрутке. Пункты — `trackMenuItems`, здесь — их действия.
import {
  AudioWaveform,
  Disc3,
  Download,
  Heart,
  HeartOff,
  ListEnd,
  ListPlus,
  ListX,
  ThumbsDown,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { create } from 'zustand';
import { isBlocked } from '../../../shared/blacklist';
import type { Track } from '../../../shared/types';
import { openArtistByName } from '../../screens/artist/artistData';
import { openAlbum } from '../../screens/artist/artistNav';
import { dislikeTrack } from '../../stores/blacklistActions';
import { initDownloads, useDownloads, useDownloadView } from '../../stores/useDownloads';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';
import { trackWaveSeed, useWave } from '../../stores/useWave';
import { AddToPlaylistPopupAt } from '../AddToPlaylistMenu/AddToPlaylistMenu';
import { MenuPopup, menuPositionAt, useMenuDismiss, type MenuItem } from '../Menu/Menu';
import { menuPoint, trackMenuItems, type TrackMenuAction, type TrackMenuIcon, type TrackMenuPlace } from './trackMenuItems';

const MENU_WIDTH = 264;

const ICONS: Record<TrackMenuIcon, LucideIcon> = {
  like: Heart,
  unlike: HeartOff,
  dislike: ThumbsDown,
  playNext: ListEnd,
  remove: ListX,
  playlist: ListPlus,
  download: Download,
  cancel: X,
  wave: AudioWaveform,
  artist: UserRound,
  album: Disc3,
};

interface OpenMenu {
  track: Track;
  place: TrackMenuPlace;
  x: number;
  y: number;
  /** Очередь: строка в будущей части и текущая ли она (по строке, а не по id: один трек может стоять дважды). */
  upcoming?: boolean;
  current?: boolean;
  /** Очередь: индекс строки в `usePlayer.queue` — «Играть следующим» переносит именно её. */
  queueIndex?: number;
  /** Элемент, которому вернуть фокус после Esc. */
  returnFocus?: HTMLElement | null;
}

interface TrackMenuState {
  menu: OpenMenu | null;
  playlist: { track: Track; x: number; y: number } | null;
}

const useTrackMenu = create<TrackMenuState>(() => ({ menu: null, playlist: null }));

export interface TrackMenuExtra {
  /** Очередь: состояние строки и её индекс в `usePlayer.queue`. */
  upcoming?: boolean;
  current?: boolean;
  queueIndex?: number;
}

/** Открыть меню трека в точке (координаты окна). */
export function openTrackMenuAt(track: Track, place: TrackMenuPlace, x: number, y: number, extra: TrackMenuExtra = {}, returnFocus?: HTMLElement | null): void {
  useTrackMenu.setState({ menu: { track, place, x, y, ...extra, returnFocus }, playlist: null });
}

/**
 * Обработчик `onContextMenu` строки: меню у курсора; с клавиатуры (клавиша меню, Shift+F10 на строке в фокусе) — у строки.
 * Системное меню браузера не показывается.
 */
export function openTrackMenu(e: ReactMouseEvent<HTMLElement>, track: Track, place: TrackMenuPlace, extra: TrackMenuExtra = {}): void {
  e.preventDefault();
  e.stopPropagation();
  const { x, y } = menuPoint(e, e.currentTarget.getBoundingClientRect());
  openTrackMenuAt(track, place, x, y, extra, e.currentTarget);
}

/** Клавиша меню или Shift+F10 на строке в фокусе — меню у строки. true — клавиша обработана. */
export function openTrackMenuByKey(e: ReactKeyboardEvent<HTMLElement>, track: Track, place: TrackMenuPlace, extra: TrackMenuExtra = {}): boolean {
  if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return false;
  e.preventDefault();
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  openTrackMenuAt(track, place, r.left + 24, r.bottom - 4, extra, e.currentTarget);
  return true;
}

/** «⋯» в строке таблицы: то же меню под кнопкой. */
export function openTrackMenuBelow(button: HTMLElement, track: Track, place: TrackMenuPlace): void {
  const r = button.getBoundingClientRect();
  openTrackMenuAt(track, place, Math.max(0, r.right - MENU_WIDTH), r.bottom + 6, {}, button);
}

const closeMenu = () => useTrackMenu.setState({ menu: null });
const closePlaylist = () => useTrackMenu.setState({ playlist: null });

/** «Убрать из очереди»: именно этот будущий трек (одинаковые объекты — по одному за раз). Волну не выключает. */
export function removeFromQueue(track: Track): void {
  let done = false;
  usePlayer.getState().removeUpcoming((t) => {
    if (done || t !== track) return false;
    done = true;
    return true;
  });
}

function run(menu: OpenMenu, action: TrackMenuAction): void {
  const { track } = menu;
  switch (action.kind) {
    case 'like':
      useLibrary.getState().toggleLike(track);
      return;
    case 'dislike':
      dislikeTrack(track);
      return;
    case 'playNext':
      usePlayer.getState().playNext(track, menu.queueIndex);
      useUi.getState().toast(`«${track.title}» — следующим`);
      return;
    case 'removeFromQueue':
      removeFromQueue(track);
      return;
    case 'addToPlaylist':
      useTrackMenu.setState({ playlist: { track, x: menu.x, y: menu.y } });
      return;
    case 'download':
      useDownloads.getState().start(track);
      return;
    case 'cancelDownload':
      useDownloads.getState().cancel(track.id);
      return;
    case 'wave':
      void useWave.getState().start(trackWaveSeed(track));
      return;
    case 'artist':
      void openArtistByName(action.name);
      return;
    case 'album':
      openAlbum(action.releaseId);
      return;
  }
}

function OpenTrackMenu({ menu }: { menu: OpenMenu }) {
  const { track } = menu;
  const liked = useLibrary((s) => s.lib.likes.includes(track.id));
  const blocked = useLibrary((s) => isBlocked(track, s.lib.blacklist));
  const playingId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const view = useDownloadView(track.id);
  const current = menu.place === 'queue' ? !!menu.current : playingId === track.id;
  const entries = trackMenuItems({
    track,
    place: menu.place,
    liked,
    current,
    upcoming: menu.upcoming,
    blocked: menu.place !== 'queue' && blocked,
    download: view.kind === 'done' ? 'done' : view.kind === 'none' ? 'none' : 'active',
  });
  const items: MenuItem[] = entries.map((e) => ({
    key: e.key,
    label: e.label,
    icon: ICONS[e.icon],
    danger: e.danger,
    onSelect: () => run(menu, e.action),
  }));
  const refocus = useCallback(() => menu.returnFocus?.focus(), [menu]);
  useMenuDismiss(true, closeMenu, undefined, refocus);
  return (
    <MenuPopup
      label={`Действия с треком «${track.title}»`}
      items={items}
      position={menuPositionAt(menu.x, menu.y, MENU_WIDTH, items.length)}
      width={MENU_WIDTH}
      onClose={closeMenu}
    />
  );
}

/** Ставится один раз в корне приложения. */
export function TrackMenuHost() {
  const menu = useTrackMenu((s) => s.menu);
  const playlist = useTrackMenu((s) => s.playlist);
  useEffect(() => {
    initDownloads();
  }, []);
  // Сменился экран — меню закрывается.
  const screen = useUi((s) => s.screen);
  useEffect(() => {
    useTrackMenu.setState({ menu: null, playlist: null });
  }, [screen]);
  return (
    <>
      {menu && <OpenTrackMenu key={`${menu.track.id}:${menu.x}:${menu.y}`} menu={menu} />}
      {playlist && <AddToPlaylistPopupAt tracks={[playlist.track]} x={playlist.x} y={playlist.y} onClose={closePlaylist} />}
    </>
  );
}
