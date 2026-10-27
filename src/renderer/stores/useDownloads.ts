// Скачанное и идущие загрузки. Записи — из main (`downloads.json`), состояния — события `aura:downloads:state`.
// Ошибка загрузки — уведомление с «Повторить». Подключается один раз (`initDownloads`), повторный вызов ничего не делает.
import { create } from 'zustand';
import type { DownloadRecord, DownloadState, Track } from '../../shared/types';
import { errorMessage } from '../app/errors';
import { useUi } from './useUi';

/** Запись загрузки; `missing` — файл удалили с диска вручную (main проверяет при `list()`). */
export type DownloadEntry = DownloadRecord & { missing?: boolean };

/** Что показывать у трека: не скачан / в очереди / качается / скачан. */
export type DownloadView =
  | { kind: 'none' }
  | { kind: 'queued' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'done' };

interface DownloadsStore {
  records: Record<string, DownloadEntry>;
  states: Record<string, DownloadState>;
  /** Треки идущих загрузок — для «Повторить» и списка «Скачивается». */
  active: Record<string, Track>;
  loaded: boolean;
  refresh(): Promise<void>;
  start(track: Track): void;
  cancel(trackId: string): void;
  /** Удаляет скачанный файл и запись (подтверждение — до вызова, в интерфейсе). */
  remove(trackId: string): Promise<boolean>;
}

const without = <T,>(map: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
};

export const useDownloads = create<DownloadsStore>((set) => ({
  records: {},
  states: {},
  active: {},
  loaded: false,

  async refresh() {
    try {
      const list = (await window.aura.downloads.list()) as DownloadEntry[];
      const records: Record<string, DownloadEntry> = {};
      for (const r of list) records[r.trackId] = r;
      set({ records, loaded: true });
    } catch (err) {
      set({ loaded: true });
      useUi.getState().toast(`Не удалось прочитать список скачанного: ${errorMessage(err)}`, undefined, 'error');
    }
  },

  start(track) {
    set((s) => ({
      states: { ...s.states, [track.id]: { trackId: track.id, status: 'queued' } },
      active: { ...s.active, [track.id]: track },
    }));
    window.aura.downloads.start(track).catch((err: unknown) => {
      set((s) => ({ states: without(s.states, track.id), active: without(s.active, track.id) }));
      useUi.getState().toast(errorMessage(err, 'Не удалось скачать трек'), undefined, 'error');
    });
  },

  cancel(trackId) {
    void window.aura.downloads.cancel(trackId).catch(() => undefined);
  },

  async remove(trackId) {
    try {
      await window.aura.downloads.remove(trackId);
      set((s) => ({ records: without(s.records, trackId), states: without(s.states, trackId) }));
      return true;
    } catch (err) {
      useUi.getState().toast(errorMessage(err, 'Не удалось удалить файл'), undefined, 'error');
      return false;
    }
  },
}));

function onState(state: DownloadState): void {
  const { trackId } = state;
  const track = useDownloads.getState().active[trackId];
  if (state.status === 'queued' || state.status === 'downloading') {
    useDownloads.setState((s) => ({ states: { ...s.states, [trackId]: state } }));
    return;
  }
  // Загрузка закончилась: состояние больше не нужно, запись (если есть) приходит из main.
  useDownloads.setState((s) => ({ states: without(s.states, trackId), active: without(s.active, trackId) }));
  if (state.status === 'done') {
    void useDownloads.getState().refresh();
  } else if (state.status === 'error') {
    const title = track ? `«${track.title}»` : 'трек';
    useUi.getState().toast(
      `Не удалось скачать ${title}: ${state.message}`,
      track ? { label: 'Повторить', run: () => useDownloads.getState().start(track) } : undefined,
      'error',
    );
  }
}

let initialized = false;

/** Загружает список скачанного и подписывается на события загрузок. */
export function initDownloads(): void {
  if (initialized) return;
  initialized = true;
  window.aura.downloads.onState(onState);
  void useDownloads.getState().refresh();
}

/** Состояние трека для кнопки «Скачать». */
export function useDownloadView(trackId: string | null): DownloadView {
  const state = useDownloads((s) => (trackId ? s.states[trackId] : undefined));
  const downloaded = useDownloads((s) => (trackId ? Boolean(s.records[trackId] && !s.records[trackId].missing) : false));
  if (state?.status === 'queued') return { kind: 'queued' };
  if (state?.status === 'downloading') return { kind: 'downloading', progress: state.progress };
  if (downloaded) return { kind: 'done' };
  return { kind: 'none' };
}
