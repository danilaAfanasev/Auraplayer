// Треки «Моих файлов» для экрана и настроек: список из индекса main и пересканирование папок.
import { create } from 'zustand';
import type { Track } from '../../../shared/types';
import { errorMessage } from '../../app/errors';
import { flushSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { useSearchQueries } from '../search/sourceQueries';

/** `missing` — файл удалили с диска после сканирования. */
export type LocalTrack = Track & { missing?: boolean };

interface LocalTracksStore {
  tracks: LocalTrack[];
  loaded: boolean;
  scanning: boolean;
  /** Список из индекса (с проверкой, что файлы на месте). */
  load(): Promise<void>;
  /** Пересканировать папки из настроек; возвращает число найденных треков или null при ошибке. */
  rescan(): Promise<number | null>;
}

/** Ответы поиска по «Моим файлам» устарели — при следующем поиске запросим заново. */
function forgetLocalSearches(): void {
  const entries = { ...useSearchQueries.getState().entries };
  for (const key of Object.keys(entries)) {
    if (entries[key]?.local) {
      const rest = { ...entries[key] };
      delete rest.local;
      entries[key] = rest;
    }
  }
  useSearchQueries.setState({ entries });
}

export const useLocalTracks = create<LocalTracksStore>((set, get) => ({
  tracks: [],
  loaded: false,
  scanning: false,

  async load() {
    try {
      await flushSettings(); // main читает папки из сохранённых настроек
      set({ tracks: (await window.aura.local.tracks()) as LocalTrack[], loaded: true });
    } catch (err) {
      set({ loaded: true });
      useUi.getState().toast(`Не удалось прочитать «Мои файлы»: ${errorMessage(err)}`, undefined, 'error');
    }
  },

  async rescan() {
    if (get().scanning) return null;
    set({ scanning: true });
    try {
      await flushSettings();
      const found = await window.aura.local.rescan();
      forgetLocalSearches();
      set({ tracks: (await window.aura.local.tracks()) as LocalTrack[], loaded: true });
      return found.length;
    } catch (err) {
      useUi.getState().toast(`Не удалось просканировать папки: ${errorMessage(err)}`, undefined, 'error');
      return null;
    } finally {
      set({ scanning: false });
    }
  },
}));
