// Состояние интерфейса: текущий экран, «Назад», строка поиска, уведомления.
import { create } from 'zustand';

export type ScreenName =
  | 'home'
  | 'charts'
  | 'soundcloud'
  | 'search'
  | 'browse'
  | 'tag'
  | 'playlist'
  | 'likes'
  | 'downloads'
  | 'local'
  | 'history'
  | 'settings'
  | 'artist'
  | 'album'
  | 'following';

/**
 * `param`: для `tag` — тег жанра, для `playlist` — id плейлиста,
 * для `artist` — `id:<id каталога>` или `name:<имя>` (см. `screens/artist/artistNav.ts`), для `album` — id релиза.
 */
export interface Screen {
  name: ScreenName;
  param?: string;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  text: string;
  action?: ToastAction;
  kind: 'info' | 'error';
}

export const TOAST_DURATION_MS = 4500;
const BACK_LIMIT = 30;

interface UiState {
  screen: Screen;
  /** Предыдущие экраны для «Назад» (последний — ближайший). */
  backStack: Screen[];
  query: string;
  toasts: ToastItem[];
  navigate(screen: Screen): void;
  /** На предыдущий экран; его нет — на главную. */
  back(): void;
  /** Меняет строку поиска; непустая строка открывает экран поиска. */
  setQuery(query: string): void;
  toast(text: string, action?: ToastAction, kind?: ToastItem['kind']): number;
  dismissToast(id: number): void;
}

let toastSeq = 0;

export const sameScreen = (a: Screen, b: Screen): boolean => a.name === b.name && (a.param ?? '') === (b.param ?? '');

export const useUi = create<UiState>((set, get) => ({
  screen: { name: 'home' },
  backStack: [],
  query: '',
  toasts: [],

  navigate(screen) {
    const { screen: current, backStack } = get();
    if (sameScreen(current, screen)) return;
    set({ screen, backStack: [...backStack, current].slice(-BACK_LIMIT) });
  },

  back() {
    const stack = get().backStack;
    const prev = stack[stack.length - 1] ?? { name: 'home' };
    set({ screen: prev, backStack: stack.slice(0, -1) });
  },

  setQuery(query) {
    set({ query });
    if (query.trim() && get().screen.name !== 'search') get().navigate({ name: 'search' });
  },

  toast(text, action, kind = 'info') {
    const id = ++toastSeq;
    // Одинаковое уведомление подряд не дублируем — обновляем существующее.
    const toasts = get().toasts.filter((t) => t.text !== text);
    set({ toasts: [...toasts, { id, text, action, kind }].slice(-4) });
    setTimeout(() => get().dismissToast(id), action ? TOAST_DURATION_MS + 2000 : TOAST_DURATION_MS);
    return id;
  },

  dismissToast(id) {
    if (!get().toasts.some((t) => t.id === id)) return;
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
