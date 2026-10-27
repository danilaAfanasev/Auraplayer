// Свёрнутость сайдбара (D01). Выбор пользователя сохраняется; в узком окне (< 1200 px)
// сайдбар сворачивается сам, но кнопкой его можно временно раскрыть — иначе в нём не добраться до поиска.
import { create } from 'zustand';

/** Окно уже этого — сайдбар сворачивается автоматически. */
export const NARROW_QUERY = '(max-width: 1199px)';
const STORAGE_KEY = 'aura.sidebar.collapsed';

interface SidebarState {
  /** Выбор пользователя в обычном окне (сохраняется между запусками). */
  userCollapsed: boolean;
  /** Окно уже 1200 px. */
  narrow: boolean;
  /** В узком окне пользователь раскрыл сайдбар (до смены ширины окна). */
  narrowExpanded: boolean;
  toggle(): void;
  expand(): void;
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStored(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // хранилище недоступно — состояние просто не переживёт перезапуск
  }
}

const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null;

/** Свёрнут ли сайдбар сейчас. */
export const selectCollapsed = (s: Pick<SidebarState, 'userCollapsed' | 'narrow' | 'narrowExpanded'>): boolean =>
  s.narrow ? !s.narrowExpanded : s.userCollapsed;

export const useSidebar = create<SidebarState>((set, get) => ({
  userCollapsed: readStored(),
  narrow: media?.matches ?? false,
  narrowExpanded: false,

  toggle() {
    const s = get();
    if (s.narrow) {
      set({ narrowExpanded: !s.narrowExpanded });
      return;
    }
    writeStored(!s.userCollapsed);
    set({ userCollapsed: !s.userCollapsed });
  },

  expand() {
    if (selectCollapsed(get())) get().toggle();
  },
}));

// Окно перешло порог — раскладка снова «автоматическая».
media?.addEventListener('change', (e) => useSidebar.setState({ narrow: e.matches, narrowExpanded: false }));

export const useSidebarCollapsed = (): boolean => useSidebar(selectCollapsed);
