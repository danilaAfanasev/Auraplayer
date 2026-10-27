// Списки раздела SoundCloud: снимки из main по запросу (жанр, регион), повторы и обновление раз в несколько часов.
// Кэш и срок жизни — в main (`soundcloud-charts.json`); здесь только последние ответы для отрисовки.
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { ScChartQuery, ScChartResult } from '../../../shared/api';
import { withoutBlocked } from '../../../shared/blacklist';
import { errorMessage } from '../../app/errors';
import { useBlacklist } from '../../stores/blacklistActions';
import { flushPendingSaves } from '../../stores/persist';
import { useSettings } from '../../stores/useSettings';

/** Пока раздел открыт, main спрашивается так часто; грузит заново он сам, когда список устарел. */
const RECHECK_MS = 30 * 60_000;

export interface ScChartEntry {
  /** Последний ответ main; null — ещё не было. */
  result: ScChartResult | null;
  loading: boolean;
}

interface ScChartState {
  entries: Record<string, ScChartEntry>;
  load(query: ScChartQuery, force?: boolean): Promise<void>;
}

export const chartKey = (q: ScChartQuery): string => `${q.kind}:${q.genre}:${q.region}`;

const EMPTY: ScChartEntry = { result: null, loading: true };

export const useScCharts = create<ScChartState>((set, get) => ({
  entries: {},

  async load(query, force = false) {
    const key = chartKey(query);
    const prev = get().entries[key];
    if (prev?.loading && !force) return;
    set({ entries: { ...get().entries, [key]: { result: prev?.result ?? null, loading: true } } });
    let result: ScChartResult;
    try {
      result = await window.aura.soundcloud.chart(query, { force });
    } catch (err) {
      result = { tracks: prev?.result?.tracks ?? [], updatedAt: prev?.result?.updatedAt ?? null, error: { kind: 'unknown', message: errorMessage(err) } };
    }
    set({ entries: { ...get().entries, [key]: { result, loading: false } } });
  },
}));

/**
 * Список по запросу: грузится при открытии, при смене жанра/региона, при включении SoundCloud и раз в полчаса — проверка срока.
 * Треки — уже без чёрного списка (таблица, «Слушать» и волна раздела получают один и тот же список).
 */
export function useScChart(query: ScChartQuery): ScChartEntry & { retry(): void } {
  const key = chartKey(query);
  const enabled = useSettings((s) => s.settings.soundcloudEnabled);
  const raw = useScCharts((s) => s.entries[key]) ?? EMPTY;
  const blacklist = useBlacklist();
  const entry = useMemo((): ScChartEntry => {
    const tracks = raw.result?.tracks;
    if (!raw.result || !tracks) return raw;
    const shown = withoutBlocked(tracks, blacklist, (t) => t);
    return shown === tracks ? raw : { ...raw, result: { ...raw.result, tracks: shown } };
  }, [raw, blacklist]);

  useEffect(() => {
    const q: ScChartQuery = { kind: query.kind, genre: query.genre, region: query.region };
    // Только что включённый SoundCloud должен успеть записаться в настройки, которые читает main.
    void flushPendingSaves().then(() => useScCharts.getState().load(q));
    const timer = setInterval(() => void useScCharts.getState().load(q), RECHECK_MS);
    return () => clearInterval(timer);
    // Запрос целиком описан key.
  }, [key, enabled]);

  return { ...entry, retry: () => void useScCharts.getState().load(query, true) };
}
