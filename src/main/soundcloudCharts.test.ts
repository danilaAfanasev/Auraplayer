import { describe, expect, it } from 'vitest';
import type { ScChartQuery } from '../shared/api';
import type { Track } from '../shared/types';
import { SC_CHART_TTL_MS, createScChartsService, pickRussianTracks } from './soundcloudCharts';
import searchRu from './sources/__fixtures__/soundcloud-search-ru.json';
import { fetchScSearch, type ScPlaylist } from './sources/soundcloud';
import type { RunYtDlp } from './sources/youtube';
import { SourceError } from './sources/types';

/** id плейлистов-чартов аккаунтов music-charts-us / music-charts-uk (проверено в октябре 2026). */
const US_HIPHOP = '1714689219';
const UK_HIPHOP = '1714689438';
const US_NEW_HOT = '1712717571';
const UK_NEW_HOT = '1712718282';
const US_ARTIST_PRO = '1712717550';
const UK_ARTIST_PRO = '1712718252';
const US_POP = '1714689168';
const UK_POP = '1714689405';
const DAY = 24 * 60 * 60_000;

const t = (id: string, genre?: string): Track => ({
  id: `soundcloud:${id}`,
  source: 'soundcloud',
  sourceId: id,
  title: `T${id}`,
  artist: `A${id}`,
  downloadable: true,
  ...(genre ? { tags: [genre] } : {}),
});

const q = (kind: ScChartQuery['kind'], genre: ScChartQuery['genre'] = 'all', region: ScChartQuery['region'] = 'all'): ScChartQuery => ({
  kind,
  genre,
  region,
});

function setup(lists: Record<string, Track[] | Error | ScPlaylist>, opts: { stored?: unknown; enabled?: boolean } = {}) {
  let file: unknown = opts.stored ?? null;
  let now = 1_000_000;
  const loads: string[] = [];
  const service = createScChartsService({
    load: async (id) => {
      loads.push(id);
      const v = lists[id];
      if (v instanceof Error) throw v;
      return Array.isArray(v) || !v ? { tracks: v ?? [], createdAt: {}, plays: {} } : v;
    },
    read: async () => file,
    write: async (data) => {
      file = data;
    },
    enabled: async () => opts.enabled ?? true,
    now: () => now,
  });
  return { service, loads, file: () => file, advance: (ms: number) => (now += ms) };
}

describe('createScChartsService — «Популярное» и «Свежее» на SoundCloud', () => {
  it('популярное по жанру, все регионы: чарты США и Великобритании вперемешку, без повторов', async () => {
    const { service, loads } = setup({ [US_HIPHOP]: [t('1'), t('2'), t('3')], [UK_HIPHOP]: [t('9'), t('2'), t('8')] });
    const res = await service.get(q('top', 'hiphop'));
    expect(loads.sort()).toEqual([US_HIPHOP, UK_HIPHOP].sort());
    expect(res.tracks.map((x) => x.sourceId)).toEqual(['1', '9', '2', '3', '8']);
    expect(res.error).toBeNull();
    expect(res.updatedAt).toBe(1_000_000);
  });

  it('регион: только его чарт', async () => {
    const { service, loads } = setup({ [UK_HIPHOP]: [t('9')] });
    const res = await service.get(q('top', 'hiphop', 'uk'));
    expect(loads).toEqual([UK_HIPHOP]);
    expect(res.tracks.map((x) => x.sourceId)).toEqual(['9']);
  });

  it('кэш: повтор в пределах срока не грузит заново; после срока и с force — грузит', async () => {
    const { service, loads, advance } = setup({ [UK_HIPHOP]: [t('9')] });
    await service.get(q('top', 'hiphop', 'uk'));
    await service.get(q('top', 'hiphop', 'uk'));
    expect(loads).toHaveLength(1);
    advance(SC_CHART_TTL_MS + 1);
    await service.get(q('top', 'hiphop', 'uk'));
    expect(loads).toHaveLength(2);
    await service.get(q('top', 'hiphop', 'uk'), { force: true });
    expect(loads).toHaveLength(3);
  });

  it('списки сохраняются в файл: следующий запуск отдаёт их без загрузки', async () => {
    const first = setup({ [UK_HIPHOP]: [t('9')] });
    await first.service.get(q('top', 'hiphop', 'uk'));
    const second = setup({}, { stored: first.file() });
    const res = await second.service.get(q('top', 'hiphop', 'uk'));
    expect(second.loads).toEqual([]);
    expect(res.tracks.map((x) => x.sourceId)).toEqual(['9']);
  });

  it('SoundCloud не отвечает: есть сохранённый список — он и ошибка; нет — пусто и просьба включить VPN', async () => {
    const offline = new SourceError('offline', 'Нет соединения с SoundCloud');
    const first = setup({ [UK_HIPHOP]: [t('9')] });
    await first.service.get(q('top', 'hiphop', 'uk'));
    const again = setup({ [UK_HIPHOP]: offline }, { stored: first.file() });
    const res = await again.service.get(q('top', 'hiphop', 'uk'), { force: true });
    expect(res.tracks.map((x) => x.sourceId)).toEqual(['9']);
    expect(res.error?.kind).toBe('offline');

    const empty = await setup({ [UK_HIPHOP]: offline }).service.get(q('top', 'hiphop', 'uk'));
    expect(empty.tracks).toEqual([]);
    expect(empty.updatedAt).toBeNull();
    expect(empty.error?.message).toBe('SoundCloud не отвечает — включи VPN и нажми «Повторить»');
  });

  it('SoundCloud выключен в настройках — ничего не грузит, ошибка disabled', async () => {
    const { service, loads } = setup({ [UK_HIPHOP]: [t('9')] }, { enabled: false });
    const res = await service.get(q('top', 'hiphop', 'uk'));
    expect(loads).toEqual([]);
    expect(res.error?.kind).toBe('disabled');
  });

  it('свежее: «New & Hot» и «Artist Pro» (набирают популярность), по жанру — по жанру трека', async () => {
    const { service, loads } = setup({
      [US_NEW_HOT]: [t('1', 'Hip-hop & Rap'), t('2', 'House'), t('3', 'Rap/Hip Hop')],
      [UK_NEW_HOT]: [t('4', 'Dance & EDM'), t('5', 'Trap')],
      [US_ARTIST_PRO]: [t('6', 'Pop'), t('7', 'Drill')],
      [UK_ARTIST_PRO]: [t('8', 'R&B & Soul')],
    });
    const all = await service.get(q('fresh'));
    expect(loads.sort()).toEqual([US_NEW_HOT, UK_NEW_HOT, US_ARTIST_PRO, UK_ARTIST_PRO].sort());
    expect(all.tracks).toHaveLength(8);
    const rap = await service.get(q('fresh', 'hiphop'));
    expect(rap.tracks.map((x) => x.sourceId).sort()).toEqual(['1', '3', '5', '7']);
    const edm = await service.get(q('fresh', 'electronic'));
    expect(edm.tracks.map((x) => x.sourceId).sort()).toEqual(['2', '4']);
  });

  it('свежее по жанру дополняется недавно загруженными треками чарта жанра (за ~45 дней), новые раньше', async () => {
    const now = 1_000_000 + 100 * DAY;
    const { service, advance } = setup({
      [US_NEW_HOT]: [t('1', 'Pop')],
      [US_POP]: { tracks: [t('p1'), t('p2'), t('p3')], createdAt: { p1: now - 60 * DAY, p2: now - 10 * DAY, p3: now - 2 * DAY }, plays: {} },
      [UK_POP]: { tracks: [t('u1')], createdAt: { u1: now - 5 * DAY }, plays: {} },
    });
    advance(100 * DAY);
    const res = await service.get(q('fresh', 'pop'));
    expect(res.tracks.map((x) => x.sourceId)).toEqual(['1', 'p3', 'u1', 'p2']);
  });

  it('не больше двух загрузок одновременно; то, что запрошено последним (выбранный жанр), — первым из очереди', async () => {
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    let active = 0;
    let peak = 0;
    const service = createScChartsService({
      load: (id) =>
        new Promise((resolve) => {
          started.push(id);
          active++;
          peak = Math.max(peak, active);
          pending.set(id, () => {
            active--;
            resolve({ tracks: [t(id)], createdAt: {}, plays: {} });
          });
        }),
      read: async () => null,
      write: async () => undefined,
      enabled: async () => true,
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const finish = async (id: string) => {
      pending.get(id)!();
      pending.delete(id);
      await tick();
    };
    // Первое открытие раздела: «Популярное» и «Свежее» всех регионов — 6 списков.
    const top = service.get(q('top'));
    const fresh = service.get(q('fresh'));
    await tick();
    expect(started).toHaveLength(2);
    // Пользователь выбрал жанр «Хип-хоп» в «Популярном», пока «Свежее» ещё в очереди.
    const hiphop = service.get(q('top', 'hiphop'));
    await tick();
    await finish(started[0]!);
    await finish(started[1]!);
    expect(started.slice(2, 4).sort()).toEqual([US_HIPHOP, UK_HIPHOP].sort());
    while (pending.size > 0) await finish([...pending.keys()][0]!);
    const results = await Promise.all([top, fresh, hiphop]);
    expect(peak).toBe(2);
    expect(started).toHaveLength(8);
    expect(results.every((r) => r.error === null && r.tracks.length > 0)).toBe(true);
  });

  it('один и тот же чарт, запрошенный дважды одновременно, грузится один раз', async () => {
    const { service, loads } = setup({ [UK_HIPHOP]: [t('9')] });
    await Promise.all([service.get(q('top', 'hiphop', 'uk')), service.get(q('top', 'hiphop', 'uk'))]);
    expect(loads).toEqual([UK_HIPHOP]);
  });
});

describe('популярное и свежее в России — из поиска SoundCloud (своего чарта у России нет)', () => {
  const NOW = Date.UTC(2026, 9, 26);
  /** Выдача поиска «русский рэп» (образец) — как её отдаёт fetchScSearch. */
  async function ruSearch(): Promise<ScPlaylist> {
    const body = Buffer.from(JSON.stringify(searchRu)).toString('base64');
    const run: RunYtDlp = async () => ({ stdout: `Dumping request to https://api-v2.soundcloud.com/search/tracks?q=x\n${body}`, stderr: '' });
    return fetchScSearch(run, 'русский рэп');
  }
  const latin: ScPlaylist = {
    tracks: [{ ...t('777'), title: 'GO GLITCH!', artist: 'ionglitch', durationSec: 131 }],
    createdAt: { '777': NOW - 5 * DAY },
    plays: { '777': 99_000_000 },
  };

  it('популярное: только кириллица, по прослушиваниям; загруженное за год — раньше старого; без дублей, длинных миксов и DRM', async () => {
    const tracks = pickRussianTracks([await ruSearch(), latin], { kind: 'top', now: NOW });
    const ids = tracks.map((x) => x.sourceId);
    // Разобрано вручную по образцу: единственный трек за последний год, затем самые прослушиваемые.
    expect(ids.slice(0, 6)).toEqual(['2231656853', '245269075', '233026709', '1969835903', '247069997', '251722212']);
    expect(ids).not.toContain('777'); // латиница
    expect(ids).not.toContain('2417241789'); // DRM
    expect(ids).not.toContain('208336822'); // микс на 35 минут
    // «Честный — А ты прости мама…» залит дважды — остаётся один, где больше прослушиваний.
    expect(ids).toContain('504192855');
    expect(ids).not.toContain('880452394');
    expect(tracks.every((x) => /[А-Яа-яЁё]/.test(`${x.title} ${x.artist}`))).toBe(true);
  });

  it('один исполнитель — не больше двух треков', () => {
    const list: ScPlaylist = {
      tracks: ['1', '2', '3', '4'].map((id) => ({ ...t(id), title: `Песня ${id}`, artist: 'Баста, Гуф', durationSec: 200 })),
      createdAt: { '1': NOW - DAY, '2': NOW - DAY, '3': NOW - DAY, '4': NOW - DAY },
      plays: { '1': 4, '2': 3, '3': 2, '4': 1 },
    };
    expect(pickRussianTracks([list], { kind: 'top', now: NOW }).map((x) => x.sourceId)).toEqual(['1', '2']);
  });

  it('повторная заливка — то же название с другими пробелами; треки, различающиеся буквой «s», — разные', () => {
    const list: ScPlaylist = {
      tracks: [
        { ...t('1'), title: 'Sad', artist: 'Исполнитель', durationSec: 200 },
        { ...t('2'), title: 'Ad', artist: 'Исполнитель', durationSec: 200 },
        { ...t('3'), title: 'Кто  я', artist: 'Певица', durationSec: 200 },
        { ...t('4'), title: 'Кто я', artist: 'Певица', durationSec: 200 },
      ],
      createdAt: { '1': NOW - DAY, '2': NOW - DAY, '3': NOW - DAY, '4': NOW - DAY },
      plays: { '1': 4, '2': 3, '3': 2, '4': 1 },
    };
    expect(pickRussianTracks([list], { kind: 'top', now: NOW }).map((x) => x.sourceId)).toEqual(['1', '2', '3']);
  });

  it('свежее: только загруженное за последние ~2 месяца, по прослушиваниям', () => {
    const list: ScPlaylist = {
      tracks: [
        { ...t('old'), title: 'Старая', artist: 'Исполнитель А', durationSec: 200 },
        { ...t('new1'), title: 'Новая', artist: 'Исполнитель Б', durationSec: 200 },
        { ...t('new2'), title: 'Ещё новее', artist: 'Исполнитель В', durationSec: 200 },
      ],
      createdAt: { old: NOW - 200 * DAY, new1: NOW - 10 * DAY, new2: NOW - 3 * DAY },
      plays: { old: 1000, new1: 50, new2: 70 },
    };
    expect(pickRussianTracks([list, latin], { kind: 'fresh', now: NOW }).map((x) => x.sourceId)).toEqual(['new2', 'new1']);
  });

  it('регион «Россия»: вместо чартов — поиск SoundCloud по русским запросам жанра', async () => {
    const { service, loads } = setup({});
    await service.get(q('top', 'hiphop', 'ru'));
    expect(loads.length).toBeGreaterThanOrEqual(2);
    expect(loads.every((id) => id.startsWith('search:'))).toBe(true);
    expect(loads).toContain('search:русский рэп');
  });
});
