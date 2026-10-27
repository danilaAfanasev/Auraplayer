import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/settings';
import type { Track } from '../../shared/types';
import { YtDlpError } from '../ytdlp';
import searchPage from './__fixtures__/soundcloud-search-page.json';
import searchSample from './__fixtures__/soundcloud-search.json';
import chartPlaylist from './__fixtures__/soundcloud-chart-playlist.json';
import chartTracks from './__fixtures__/soundcloud-chart-tracks.json';
import relatedPage from './__fixtures__/soundcloud-related.json';
import searchRu from './__fixtures__/soundcloud-search-ru.json';
import trackSample from './__fixtures__/soundcloud-track.json';
import {
  classifyScError,
  createSoundcloudAdapter,
  fetchScPlaylist,
  fetchScRecommended,
  fetchScSearch,
  parseScAccess,
  parseScApiTracks,
  parseScSearch,
  parseScStream,
  searchScStream,
} from './soundcloud';
import { SourceError, type SourceContext } from './types';
import type { RunYtDlp } from './youtube';

const ctx: SourceContext = { settings: defaultSettings('C:\\Music\\Aura'), userDataDir: 'C:\\data' };
/** Часы тестов потока: за час до срока ссылки образца (`expires`) — тест не зависит от системных часов. */
const BEFORE_LINK_EXPIRES = Number(new URL(trackSample.url).searchParams.get('expires')) * 1000 - 3_600_000;

/** Из образца: 2420084601 — 30-секундный отрывок крупного лейбла, 1822834458 — трек под DRM. */
const PREVIEW_ID = '2420084601';
const DRM_ID = '1822834458';
const FULL_IDS = ['2420080329', '2422883991', '2422950993', '2420352996'];

const scTrack = (id: string): Track => ({
  id: `soundcloud:${id}`,
  source: 'soundcloud',
  sourceId: id,
  title: 'Housewife',
  artist: 'Tate McRae',
  downloadable: true,
});

const idOfUrl = (url: string): string => /\/tracks\/(\d+)$/.exec(url)?.[1] ?? '';

/**
 * Поддельный yt-dlp: поиск отдаёт образец, проверка печатает строку только для полных треков
 * (отрывок и DRM — ошибки, как у настоящего yt-dlp с `-i`: остальные URL обрабатываются, код выхода 1).
 */
function fakeYtDlp(calls: string[][]): RunYtDlp {
  return async (args, _signal, opts) => {
    calls.push([...args]);
    if (args.includes('--flat-playlist')) return { stdout: JSON.stringify(searchSample), stderr: '' };
    const template = args[args.indexOf('--print') + 1];
    const urls = args.slice(args.indexOf('--') + 1);
    const failed: string[] = [];
    for (const url of urls) {
      const id = idOfUrl(url);
      if (FULL_IDS.includes(id)) opts?.onLine?.(template.replace('%(id)s', id));
      else failed.push(id);
    }
    if (failed.length) throw new YtDlpError('failed', `ERROR: [soundcloud] ${failed[0]}: This video is DRM protected`, '');
    return { stdout: '', stderr: '' };
  };
}

describe('parseScSearch', () => {
  it('разбирает плоский JSON scsearch: исполнитель и название, длительность, обложка, страница', () => {
    const tracks = parseScSearch(searchSample);
    expect(tracks.find((t) => t.sourceId === '2420080329')).toEqual<Track>({
      id: 'soundcloud:2420080329',
      source: 'soundcloud',
      sourceId: '2420080329',
      title: 'Housewife',
      artist: 'Tate McRae',
      durationSec: 195,
      coverUrl: 'https://i1.sndcdn.com/artworks-v3x0EbmFEUb5yMHB-XPRJbQ-t500x500.jpg',
      downloadable: true,
      pageUrl: 'https://soundcloud.com/22511409/tate-mcrae-housewife-1',
    });
  });

  it('30-секундный отрывок (длительность в выдаче 30 с) не попадает в список', () => {
    const ids = parseScSearch(searchSample).map((t) => t.sourceId);
    expect(ids).not.toContain(PREVIEW_ID);
    expect(ids).toEqual([...FULL_IDS, DRM_ID]);
  });

  it('название без « - » — исполнитель из автора загрузки', () => {
    const bad = parseScSearch(searchSample).find((t) => t.sourceId === DRM_ID);
    expect(bad).toMatchObject({ title: 'BIRDS OF A FEATHER', artist: 'Billie Eilish' });
  });

  it('мусор на входе — пустой список', () => {
    expect(parseScSearch(null)).toEqual([]);
    expect(parseScSearch({ entries: [{ id: 'x' }, 5] })).toEqual([]);
  });
});

describe('parseScAccess', () => {
  it('по ответу поиска SoundCloud: полный трек — да, отрывок (SNIP) и DRM (только зашифрованный HLS) — нет', () => {
    const access = parseScAccess(searchPage);
    expect(Object.fromEntries(access)).toEqual({
      [PREVIEW_ID]: false,
      [DRM_ID]: false,
      ...Object.fromEntries(FULL_IDS.map((id) => [id, true])),
    });
  });

  it('мусор на входе — пустой ответ', () => {
    expect(parseScAccess(null).size).toBe(0);
    expect(parseScAccess({ collection: [{ id: 'x' }, 7] }).size).toBe(0);
  });
});

describe('parseScStream', () => {
  it('URL выбранного формата (полный трек, HLS AAC)', () => {
    expect(parseScStream(trackSample)).toBe(trackSample.url);
  });

  it('выбран отрывок — понятная ошибка, а не 30 секунд вместо трека', () => {
    expect(() => parseScStream({ ...trackSample, format_id: 'http_mp3_1_0_preview' })).toThrow(/отрывок/);
  });
});

describe('classifyScError', () => {
  it('DRM, только отрывок, нет сети, тайм-аут — понятные тексты', () => {
    expect(classifyScError(new YtDlpError('failed', 'ERROR: [soundcloud] 1: This video is DRM protected', '')).message).toMatch(/защищ/i);
    expect(classifyScError(new YtDlpError('failed', 'ERROR: [soundcloud] 1: Requested format is not available', '')).message).toMatch(/отрывок/);
    expect(classifyScError(new YtDlpError('failed', 'x', '[Errno 11001] getaddrinfo failed')).kind).toBe('offline');
    expect(classifyScError(new YtDlpError('timeout', 'yt-dlp не ответил вовремя', '')).message).toMatch(/SoundCloud/);
    expect(classifyScError(new Error('???')).message).toMatch(/SoundCloud/);
  });
});

describe('адаптер SoundCloud', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aura-sc-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('поиск: один запуск yt-dlp — признаки доступа из ответа SoundCloud, без отрывков и DRM', async () => {
    const calls: string[][] = [];
    const run: RunYtDlp = async (args) => {
      calls.push([...args]);
      // Вывод `-J --no-quiet --dump-pages`: строки хода работы, страница ответа API в base64, затем JSON.
      const stdout = [
        '[soundcloud:search] Extracting URL: scsearch20:Tate McRae Housewife',
        '[soundcloud:search] Dumping request to https://api-v2.soundcloud.com/search/tracks?limit=20&q=Tate+McRae+Housewife&offset=0',
        Buffer.from(JSON.stringify(searchPage)).toString('base64'),
        '[soundcloud:search] Playlist Tate McRae Housewife: Downloading 6 items of 6',
        JSON.stringify(searchSample),
        '',
      ].join('\r\n');
      return { stdout, stderr: '' };
    };
    const tracks = await createSoundcloudAdapter(run).search('Tate McRae Housewife', ctx);
    expect(tracks.map((t) => t.sourceId)).toEqual(FULL_IDS);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.arrayContaining(['--flat-playlist', '-J', '--dump-pages', 'scsearch20:Tate McRae Housewife']));
  });

  it('поиск: yt-dlp не показал ответ SoundCloud — проверка найденного без скачивания, без отрывков и DRM', async () => {
    const calls: string[][] = [];
    const tracks = await createSoundcloudAdapter(fakeYtDlp(calls)).search('Tate McRae Housewife', ctx);
    expect(tracks.map((t) => t.sourceId)).toEqual(FULL_IDS);
    expect(calls[0]).toEqual(expect.arrayContaining(['--flat-playlist', '-J', 'scsearch20:Tate McRae Housewife']));
    const checks = calls.slice(1);
    expect(checks.length).toBeGreaterThan(0);
    for (const args of checks) {
      // Проверка без скачивания: формат «лучшее аудио, но не отрывок», ошибки отдельных треков не останавливают остальные.
      expect(args).toEqual(expect.arrayContaining(['-i', '--print']));
      expect(args[args.indexOf('-f') + 1]).toMatch(/format_id!\*=preview/);
    }
    const checked = checks.flatMap((a) => a.slice(a.indexOf('--') + 1).map(idOfUrl));
    expect(checked).not.toContain(PREVIEW_ID); // отрывок отсеян ещё по выдаче — лишнего запроса нет
  });

  it('поиск: нет сети — ошибка источника «offline»', async () => {
    const run: RunYtDlp = async () => {
      throw new YtDlpError('failed', 'ERROR: Unable to download', 'urlopen error [Errno 11001] getaddrinfo failed');
    };
    await expect(createSoundcloudAdapter(run).search('x', ctx)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('поток: ссылка из ответа yt-dlp без отрывков; повтор — из кэша, fresh — заново', async () => {
    const calls: string[][] = [];
    const run: RunYtDlp = async (args) => {
      calls.push([...args]);
      return { stdout: JSON.stringify(trackSample), stderr: '' };
    };
    const sc = createSoundcloudAdapter(run, () => BEFORE_LINK_EXPIRES);
    const url = await sc.resolveStream(scTrack('2420080329'), ctx);
    expect(url).toBe(trackSample.url);
    expect(calls[0].at(-1)).toBe('https://api.soundcloud.com/tracks/2420080329');
    expect(calls[0][calls[0].indexOf('-f') + 1]).toMatch(/format_id!\*=preview/);
    expect(await sc.resolveStream(scTrack('2420080329'), ctx)).toBe(url);
    expect(calls).toHaveLength(1);
    await sc.resolveStream(scTrack('2420080329'), ctx, { fresh: true });
    expect(calls).toHaveLength(2);
  });

  it('поток: неверный id не доходит до yt-dlp', async () => {
    let calls = 0;
    const run: RunYtDlp = async () => {
      calls++;
      return { stdout: '{}', stderr: '' };
    };
    await expect(createSoundcloudAdapter(run).resolveStream(scTrack('--cookies=x'), ctx)).rejects.toThrow(SourceError);
    expect(calls).toBe(0);
  });

  it('скачивание: полный трек как есть в переданный *.part, итоговый путь с расширением', async () => {
    const dest = join(dir, 'Tate McRae — Housewife.ab12.part');
    let seen: string[] = [];
    const run: RunYtDlp = async (args, _signal, opts) => {
      seen = [...args];
      opts?.onLine?.('[aura] 1000 NA 4000');
      writeFileSync(`${dest}.m4a`, 'audio');
      return { stdout: '', stderr: '' };
    };
    const progress: number[] = [];
    const out = await createSoundcloudAdapter(run).download!(scTrack('2420080329'), dest, ctx, (p) => progress.push(p), new AbortController().signal);
    expect(out).toBe(`${dest}.m4a`);
    expect(progress).toEqual(expect.arrayContaining([0.25, 1]));
    expect(seen.at(-1)).toBe('https://api.soundcloud.com/tracks/2420080329');
    expect(seen[seen.indexOf('-f') + 1]).toMatch(/format_id!\*=preview/);
    expect(seen[seen.indexOf('-o') + 1]).toBe(`${dest}.%(ext)s`);
    expect(readdirSync(dir)).toEqual(['Tate McRae — Housewife.ab12.part.m4a']);
  });
});

describe('searchScStream — полная версия трека и ссылка одним запуском', () => {
  it('один запуск: scsearch, фильтры, DRM и ошибки кандидатов пропускаются (-i), первый подходящий — трек SoundCloud со ссылкой', async () => {
    const seen: string[][] = [];
    const signal = new AbortController().signal;
    const run: RunYtDlp = async (args, s, opts) => {
      seen.push([...args]);
      expect(s).toBe(signal);
      opts?.onLine?.(JSON.stringify(trackSample));
      throw new YtDlpError('failed', 'ERROR: [soundcloud] 1822834458: This video is DRM protected');
    };
    const hit = await searchScStream(run, 'Tate McRae Housewife', ['duration>=185 & duration<=205'], { signal, now: () => BEFORE_LINK_EXPIRES });
    expect(hit?.url).toBe(trackSample.url);
    expect(hit?.track).toMatchObject({ id: 'soundcloud:2420080329', source: 'soundcloud', sourceId: '2420080329', title: 'Housewife', artist: 'Tate McRae', durationSec: 195 });
    expect(hit!.until).toBeGreaterThan(BEFORE_LINK_EXPIRES);
    expect(seen).toHaveLength(1);
    const args = seen[0];
    expect(args.slice(-2)).toEqual(['--', 'scsearch8:Tate McRae Housewife']);
    expect(args).toEqual(expect.arrayContaining(['-j', '-i', '--max-downloads', '1', '--match-filter', 'duration>=185 & duration<=205']));
    expect(args[args.indexOf('-f') + 1]).toMatch(/format_id!\*=preview/);
    expect(args.join(' ')).not.toMatch(/cookie|username|password|netrc/i);
  });

  it('ничего не подошло или все кандидаты под DRM — null; нет сети — ошибка источника', async () => {
    const none: RunYtDlp = async () => ({ stdout: '', stderr: '' });
    await expect(searchScStream(none, 'q', [])).resolves.toBeNull();
    const drm: RunYtDlp = async () => {
      throw new YtDlpError('failed', 'ERROR: [soundcloud] 1822834458: This video is DRM protected');
    };
    await expect(searchScStream(drm, 'q', [])).resolves.toBeNull();
    const offline: RunYtDlp = async () => {
      throw new YtDlpError('failed', 'ERROR: [Errno 11001] getaddrinfo failed');
    };
    await expect(searchScStream(offline, 'q', [])).rejects.toMatchObject({ kind: 'offline' });
  });
});

/** Строки вывода yt-dlp `--dump-pages`: адрес запроса и ответ в base64. */
const dumped = (url: string, body: unknown): string =>
  `[soundcloud:playlist] Dumping request to ${url}\n${Buffer.from(JSON.stringify(body)).toString('base64')}`;

/** Образец чарта (хип-хоп, Великобритания, октябрь 2026): полные треки — разобраны вручную по транскодингам. */
const CHART_OPEN_IDS = ['2407316550', '2366065991', '2411012304', '2413028277', '2347077464', '2408710155', '2405352657', '2372169605'];
/** Рекомендации к треку (образец): полные треки, остальные — DRM. */
const RELATED_OPEN_IDS = ['1578316566', '2426052057', '2059950520', '1491542173', '2402524998', '2366065991', '2409114774', '1819446642', '2410991442'];

describe('parseScApiTracks — треки из ответов API SoundCloud (чарты, рекомендации)', () => {
  it('чарт: только полные треки без входа — DRM и 30-секундный отрывок (SNIP) отсеяны, порядок чарта сохранён', () => {
    const tracks = parseScApiTracks(chartTracks);
    expect(tracks.map((t) => t.sourceId)).toEqual(CHART_OPEN_IDS);
    expect(tracks.some((t) => t.sourceId === PREVIEW_ID)).toBe(false);
  });

  it('трек: исполнитель из данных издателя, длительность, крупная обложка, страница, жанр', () => {
    const t = parseScApiTracks(chartTracks).find((x) => x.sourceId === '2405352657');
    expect(t).toEqual<Track>({
      id: 'soundcloud:2405352657',
      source: 'soundcloud',
      sourceId: '2405352657',
      title: 'ДИНАСТИЯ',
      artist: 'VILLIAN & madk1d',
      durationSec: 151,
      coverUrl: 'https://i1.sndcdn.com/artworks-ixV2b4vdLzq5p6TH-EK4Biw-t500x500.jpg',
      pageUrl: 'https://soundcloud.com/villianwhy/dinastiya-1',
      downloadable: true,
      tags: ['Hip-hop & Rap'],
    });
  });

  it('«Исполнитель - Название» без данных издателя — делится, как в поиске', () => {
    const t = parseScApiTracks(chartTracks).find((x) => x.sourceId === '2366065991');
    expect([t?.artist, t?.title]).toEqual(['G4DE', 'GBP Not Pesos']);
  });

  it('рекомендации ({collection}): только полные треки', () => {
    expect(parseScApiTracks(relatedPage).map((t) => t.sourceId)).toEqual(RELATED_OPEN_IDS);
  });

  it('заглушки плейлиста (только id) и мусор пропускаются', () => {
    expect(parseScApiTracks(chartPlaylist.tracks)).toEqual([]);
    expect(parseScApiTracks(null)).toEqual([]);
    expect(parseScApiTracks([{ id: 'x' }, 5, null])).toEqual([]);
  });
});

describe('fetchScPlaylist — чарт SoundCloud одним запуском yt-dlp', () => {
  it('плейлист по id API: треки целиком из ответа SoundCloud, который печатает --dump-pages', async () => {
    const calls: string[][] = [];
    const run: RunYtDlp = async (args) => {
      calls.push([...args]);
      const stdout = [
        dumped('https://api-v2.soundcloud.com/playlists/1714689438?secret_token=aura&client_id=abc', chartPlaylist),
        dumped('https://api-v2.soundcloud.com/tracks?ids=1%2C2&playlistId=1714689438', chartTracks),
        '{"_type": "playlist", "entries": []}',
      ].join('\n');
      return { stdout, stderr: '' };
    };
    const { tracks, createdAt } = await fetchScPlaylist(run, '1714689438');
    expect(tracks.map((t) => t.sourceId)).toEqual(CHART_OPEN_IDS);
    // Дата загрузки трека — для «Свежего» по жанру.
    expect(createdAt['2405352657']).toBe(Date.UTC(2026, 8, 22, 13, 29, 4));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.arrayContaining(['--flat-playlist', '--dump-pages']));
    expect(calls[0].at(-1)).toMatch(/^https:\/\/api-v2\.soundcloud\.com\/playlists\/1714689438\?secret_token=/);
  });

  it('SoundCloud не ответил — ошибка источника; неверный id не доходит до yt-dlp', async () => {
    const offline: RunYtDlp = async () => {
      throw new YtDlpError('failed', 'ERROR: [Errno 11001] getaddrinfo failed', '');
    };
    await expect(fetchScPlaylist(offline, '1714689438')).rejects.toMatchObject({ kind: 'offline' });
    const calls: string[][] = [];
    const run: RunYtDlp = async (args) => {
      calls.push([...args]);
      return { stdout: '', stderr: '' };
    };
    await expect(fetchScPlaylist(run, '../evil')).rejects.toBeInstanceOf(SourceError);
    expect(calls).toHaveLength(0);
  });
});

describe('fetchScRecommended — рекомендации SoundCloud к треку', () => {
  const seed: Track = { ...scTrack('2409867324'), pageUrl: 'https://soundcloud.com/morrisson-sc/cos-of-you' };

  it('страница трека + /recommended, полные треки из ответа SoundCloud, без самого трека', async () => {
    const calls: string[][] = [];
    const withSeed = { ...relatedPage, collection: [{ ...relatedPage.collection[0], id: 2409867324 }, ...relatedPage.collection] };
    const run: RunYtDlp = async (args) => {
      calls.push([...args]);
      return { stdout: dumped('https://api-v2.soundcloud.com/tracks/2409867324/related?limit=200&offset=0', withSeed), stderr: '' };
    };
    const tracks = await fetchScRecommended(run, seed);
    expect(tracks.map((t) => t.sourceId)).toEqual(RELATED_OPEN_IDS);
    expect(calls).toHaveLength(1);
    expect(calls[0].at(-1)).toBe('https://soundcloud.com/morrisson-sc/cos-of-you/recommended');
    expect(calls[0]).toEqual(expect.arrayContaining(['--flat-playlist', '--dump-pages']));
  });

  it('трек без страницы — сначала узнаёт её у yt-dlp; чужой адрес страницы не используется', async () => {
    const calls: string[][] = [];
    const run: RunYtDlp = async (args) => {
      calls.push([...args]);
      if (args.includes('--print')) return { stdout: 'https://soundcloud.com/morrisson-sc/cos-of-you\n', stderr: '' };
      return { stdout: dumped('https://api-v2.soundcloud.com/tracks/2409867324/related?limit=200', relatedPage), stderr: '' };
    };
    await fetchScRecommended(run, { ...scTrack('2409867324'), pageUrl: 'https://evil.example/x' });
    expect(calls[0].at(-1)).toBe('https://api.soundcloud.com/tracks/2409867324');
    expect(calls[1].at(-1)).toBe('https://soundcloud.com/morrisson-sc/cos-of-you/recommended');
  });
});

describe('fetchScSearch — поиск SoundCloud с прослушиваниями и датами (популярное в России)', () => {
  it('одним запуском: полные треки из ответа API поиска, число прослушиваний и дата загрузки по id', async () => {
    const calls: string[][] = [];
    const run: RunYtDlp = async (args) => {
      calls.push([...args]);
      return {
        stdout: [dumped('https://api-v2.soundcloud.com/search/tracks?limit=50&q=x&offset=0', searchRu), '{"_type": "playlist", "entries": []}'].join('\n'),
        stderr: '',
      };
    };
    const { tracks, plays, createdAt } = await fetchScSearch(run, 'русский рэп');
    expect(calls).toHaveLength(1);
    expect(calls[0].at(-1)).toBe('scsearch50:русский рэп');
    expect(calls[0]).toEqual(expect.arrayContaining(['--flat-playlist', '--dump-pages']));
    // В образце 30 треков, один (2417241789) — DRM.
    expect(tracks).toHaveLength(29);
    expect(tracks.some((t) => t.sourceId === '2417241789')).toBe(false);
    expect(plays['245269075']).toBe(13365435);
    expect(createdAt['245269075']).toBe(Date.UTC(2016, 1, 3, 18, 2, 48));
  });
});
