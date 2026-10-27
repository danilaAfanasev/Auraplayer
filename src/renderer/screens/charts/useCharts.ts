// «Популярное сейчас» в рендерере: снимок из main (кэш charts.json + состояние обновления).
// Main сам обновляет списки при запуске и каждые 6 часов и присылает снимки; здесь — подписка и «Обновить».
// `chart` — уже без треков из чёрного списка: экраны, блок главной и баннер показывают и играют один и тот же
// список; «Вернуть» возвращает трек сразу (полный список main хранит у себя).
import { useEffect } from 'react';
import { create } from 'zustand';
import type { ChartsSnapshot } from '../../../shared/api';
import { withoutBlocked } from '../../../shared/blacklist';
import type { Track } from '../../../shared/types';
import { errorMessage } from '../../app/errors';
import { useLibrary } from '../../stores/useLibrary';
import { useUi } from '../../stores/useUi';

interface ChartsState extends ChartsSnapshot {
  /** Первый снимок из main ещё не пришёл. */
  loading: boolean;
  refresh(): Promise<void>;
}

const EMPTY: ChartsSnapshot = { updatedAt: null, chart: [], refreshing: false, error: null };

/** Чарт как прислал main — до фильтра чёрного списка. */
let fullChart: Track[] = [];

const visible = (chart: Track[]): Track[] => withoutBlocked(chart, useLibrary.getState().lib.blacklist, (t) => t);

/** Снимок main → состояние: чарт без скрытых. */
function fromSnapshot(snap: ChartsSnapshot): ChartsSnapshot {
  fullChart = snap.chart;
  return { ...snap, chart: visible(fullChart) };
}

export const useCharts = create<ChartsState>((set) => ({
  ...EMPTY,
  loading: true,

  async refresh() {
    set({ refreshing: true });
    try {
      const snap = await window.aura.charts.refresh();
      set({ ...fromSnapshot(snap), loading: false });
    } catch (err) {
      set({ refreshing: false, loading: false });
      useUi.getState().toast(errorMessage(err, 'Не удалось обновить списки'), undefined, 'error');
    }
  },
}));

// Чёрный список изменился — список пересчитывается без перезапуска.
useLibrary.subscribe((s, prev) => {
  if (s.lib.blacklist !== prev.lib.blacklist) useCharts.setState({ chart: visible(fullChart) });
});

let started = false;

/** Подписка на снимки main и первый запрос; повторные вызовы ничего не делают. */
export function initCharts(): void {
  if (started) return;
  started = true;
  window.aura.charts.onUpdate((snap) => useCharts.setState({ ...fromSnapshot(snap), loading: false }));
  window.aura.charts
    .get()
    .then((snap) => useCharts.setState({ ...fromSnapshot(snap), loading: false }))
    .catch(() => useCharts.setState({ loading: false }));
}

/** Хук экранов и блоков: запускает загрузку при первом показе. */
export function useChartsInit(): void {
  useEffect(() => initCharts(), []);
}
