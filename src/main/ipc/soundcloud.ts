// Раздел SoundCloud: «Популярное» и «Свежее» (`src/main/soundcloudCharts.ts`), кэш — `soundcloud-charts.json`.
import { SC_GENRES, SC_REGIONS, type ScChartQuery, type ScChartResult } from '../../shared/api';
import { IPC } from '../../shared/ipc';
import { getSettings } from '../settingsStore';
import { SC_CHARTS_FILE, SEARCH_ID_PREFIX, createScChartsService } from '../soundcloudCharts';
import { fetchScPlaylist, fetchScSearch } from '../sources/soundcloud';
import { readJson, writeJson } from '../store';
import { runYtDlp } from '../ytdlp';
import { handle, UserError } from './handle';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanQuery(v: unknown): ScChartQuery {
  if (
    isObject(v) &&
    (v.kind === 'top' || v.kind === 'fresh') &&
    SC_GENRES.includes(v.genre as ScChartQuery['genre']) &&
    SC_REGIONS.includes(v.region as ScChartQuery['region'])
  ) {
    return { kind: v.kind, genre: v.genre as ScChartQuery['genre'], region: v.region as ScChartQuery['region'] };
  }
  throw new UserError('Неверный параметр: список SoundCloud');
}

const charts = createScChartsService({
  // Регион «Россия» — поиск (id `search:<запрос>`), остальное — плейлисты-чарты.
  load: (id) => (id.startsWith(SEARCH_ID_PREFIX) ? fetchScSearch(runYtDlp, id.slice(SEARCH_ID_PREFIX.length)) : fetchScPlaylist(runYtDlp, id)),
  read: () => readJson<unknown>(SC_CHARTS_FILE, null),
  write: (data) => writeJson(SC_CHARTS_FILE, data),
  enabled: async () => (await getSettings()).soundcloudEnabled,
});

export function registerSoundcloudIpc(): void {
  handle(
    IPC.soundcloud.chart,
    (query: unknown, opts: unknown): Promise<ScChartResult> =>
      charts.get(cleanQuery(query), { force: isObject(opts) && opts.force === true }),
  );
}
