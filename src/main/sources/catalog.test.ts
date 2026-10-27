import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../shared/settings';
import { CATALOG_NEEDS_YOUTUBE_MESSAGE, CATALOG_NOT_FOUND_MESSAGE, type Track } from '../../shared/types';
import rssSongs from './__fixtures__/apple-rss-songs.json';
import lookupAlbums from './__fixtures__/itunes-lookup-albums.json';
import lookupSongs from './__fixtures__/itunes-lookup-songs.json';
import ytSearch from './__fixtures__/youtube-search.json';
import ytShade from './__fixtures__/youtube-catalog-shade.json';
import ytBadTimes from './__fixtures__/youtube-catalog-bad-times.json';
import {
  bigArtwork,
  buildChart,
  createCatalogAdapter,
  fallbackQueries,
  fetchCatalog,
  matchFilters,
  parseAppleRss,
  parseItunesTracks,
  parseYtCandidates,
  pickYtCandidate,
  type ItunesTrack,
  type RateLimiter,
  type RequestPriority,
  type YtCandidate,
} from './catalog';
import { SourceError, type SourceAdapter, type SourceContext } from './types';
import { YtDlpError } from '../ytdlp';

/** Без ограничения частоты: тесты не делят общий ограничитель каталога. */
const NO_LIMIT: RateLimiter = { run: (_priority, fn) => fn() };

/** Ограничитель, который записывает, с каким приоритетом шли запросы. */
function recordingLimiter() {
  const runs: RequestPriority[] = [];
  const limiter: RateLimiter = {
    run: (priority, fn) => {
      runs.push(priority);
      return fn();
    },
  };
  return { limiter, runs };
}

describe('каталог: запросы через общий ограничитель частоты', () => {
  it('обновление чарта — фоновые запросы (lookup), RSS чарта — мимо ограничителя; поиск треков — как действие пользователя', async () => {
    const urls: string[] = [];
    const fetchJson = async (url: string) => {
      urls.push(url);
      return url.includes('/songs.json') ? rssSongs : lookupSongs;
    };
    const chart = recordingLimiter();
    await fetchCatalog({ fetchJson, sleep: async () => undefined, limiter: chart.limiter });
    const lookups = urls.filter((u) => u.includes('itunes.apple.com/lookup'));
    expect(lookups.length).toBeGreaterThan(0);
    expect(chart.runs).toEqual(lookups.map(() => 'background'));

    const search = recordingLimiter();
    await createCatalogAdapter({ fetchJson: async () => lookupSongs, limiter: search.limiter }).search('кино', {} as SourceContext);
    expect(search.runs).toEqual(['user']);
  });
});

const detailsMap = (): Map<string, ItunesTrack> => new Map(parseItunesTracks(lookupSongs).map((t) => [t.trackId, t]));

describe('parseAppleRss', () => {
  it('разбирает песни чарта Apple Music в его порядке', () => {
    const songs = parseAppleRss(rssSongs);
    expect(songs).toHaveLength(10);
    expect(songs[0]).toMatchObject({ id: '6793620672', name: 'ДИНАСТИЯ', artistName: 'VILLIAN & madk1d', releaseDate: '2026-07-24' });
    expect(songs[0].artworkUrl).toMatch(/^https:\/\/is1-ssl\.mzstatic\.com\/.+\/100x100bb\.jpg$/);
    expect(songs[9].id).toBe('6823194022');
  });

  it('мусор и чужой формат — пустой список', () => {
    expect(parseAppleRss({})).toEqual([]);
    expect(parseAppleRss({ feed: { results: [{ id: 5 }, null, { id: '1', name: '' }] } })).toEqual([]);
  });
});

describe('parseItunesTracks', () => {
  it('берёт только песни из lookup альбомов: длительность, номер, альбом, дата', () => {
    const tracks = parseItunesTracks(lookupAlbums);
    expect(tracks).toHaveLength(19); // 21 запись = 2 альбома + 19 песен
    expect(tracks[0]).toMatchObject({
      trackId: '6820766680',
      collectionId: '6820766679',
      title: 'WORK',
      artist: 'Captown, Niman, Truwer & Экси',
      album: 'Omertà 2',
      trackNumber: 1,
      discNumber: 1,
      durationSec: 206,
      releaseDate: '2026-10-23',
    });
    expect(tracks[0].coverUrl).toMatch(/\/600x600bb\.jpg$/);
  });

  it('убирает приписку « - Single» / « - EP» из названия альбома', () => {
    const shade = parseItunesTracks(lookupSongs).find((t) => t.trackId === '6766252279');
    expect(shade?.album).toBe('Шадэ');
  });
});

describe('bigArtwork', () => {
  it('подменяет размер обложки на 600', () => {
    expect(bigArtwork('https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/1f/cover.jpg/100x100bb.jpg')).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/1f/cover.jpg/600x600bb.jpg',
    );
    expect(bigArtwork('https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});

describe('buildChart', () => {
  it('песни чарта в его порядке, с длительностью из lookup и крупной обложкой', () => {
    const chart = buildChart(parseAppleRss(rssSongs), detailsMap());
    expect(chart.map((t) => t.id).slice(0, 4)).toEqual([
      'catalog:6793620672',
      'catalog:6820477982',
      'catalog:6766252279',
      'catalog:1394028184',
    ]);
    expect(chart[0]).toMatchObject({ source: 'catalog', sourceId: '6793620672', title: 'ДИНАСТИЯ', durationSec: 150, downloadable: true });
    expect(chart[3]).toMatchObject({ title: 'Ледяное сердце', durationSec: 267 });
    expect(chart[0].coverUrl).toMatch(/\/600x600bb\.jpg$/);
  });

  it('без lookup — трек без длительности, но в чарте', () => {
    const chart = buildChart(parseAppleRss(rssSongs), new Map());
    expect(chart).toHaveLength(10);
    expect(chart[0].durationSec).toBeUndefined();
  });
});

describe('parseYtCandidates', () => {
  it('кандидаты из плоского поиска YouTube: id, название, канал, длительность', () => {
    const list = parseYtCandidates(ytSearch);
    expect(list.length).toBeGreaterThan(3);
    expect(list[0]).toMatchObject({ id: 'xtxjm7ciwmc', title: 'Группа крови', channel: 'Группа КИНО', durationSec: 285 });
    expect(list[0].description).toMatch(/^Provided to YouTube by/);
  });
});

const cand = (id: string, title: string, channel: string, durationSec: number | undefined, description = ''): YtCandidate => ({
  id: id.padEnd(11, id[0]),
  title,
  channel,
  durationSec,
  description,
});

describe('pickYtCandidate', () => {
  const target = { artist: 'Mary Gu', title: 'Королевство кривых зеркал', durationSec: 184 };

  it('выбирает официальное аудио с длительностью в пределах ±10 с', () => {
    const list = [
      cand('a', 'Mary Gu - Королевство кривых зеркал (Official Video)', 'Mary Gu', 215),
      cand('b', 'Mary Gu — Королевство кривых зеркал (cover)', 'Vasya', 186),
      cand('d', 'Mary Gu - Королевство кривых зеркал (Lyrics)', 'Lyrics RU', 185),
      cand('c', 'Королевство кривых зеркал', 'Mary Gu - Topic', 184, 'Provided to YouTube by Warner Music'),
    ];
    expect(pickYtCandidate(list, target)?.id).toBe('ccccccccccc');
  });

  it('ничего подходящего по длительности — null', () => {
    const list = [cand('a', 'Mary Gu - Королевство кривых зеркал', 'Mary Gu', 215), cand('b', 'Королевство кривых зеркал', 'Mary Gu - Topic', 160)];
    expect(pickYtCandidate(list, target)).toBeNull();
  });

  it('граница: разница 10 с — подходит, 11 с — нет', () => {
    expect(pickYtCandidate([cand('a', 'Mary Gu - Королевство кривых зеркал', 'Mary Gu', 194)], target)?.id).toBe('aaaaaaaaaaa');
    expect(pickYtCandidate([cand('a', 'Mary Gu - Королевство кривых зеркал', 'Mary Gu', 195)], target)).toBeNull();
  });

  it('каверы, ускоренные и live отбрасываются, ремикс — только если ищем ремикс', () => {
    const list = [
      cand('s', 'Mary Gu - Королевство кривых зеркал (sped up)', 'edits', 184),
      cand('l', 'Mary Gu - Королевство кривых зеркал LIVE', 'Mary Gu', 184),
      cand('r', 'Mary Gu - Королевство кривых зеркал (Remix)', 'Mary Gu', 184),
    ];
    expect(pickYtCandidate(list, target)).toBeNull();
    expect(pickYtCandidate(list, { ...target, title: 'Королевство кривых зеркал (Remix)' })?.id).toBe('rrrrrrrrrrr');
  });

  it('видео с канала исполнителя подходит, даже если YouTube перевёл название', () => {
    // Реальная выдача ytsearch5 для «Mary Gu - Королевство кривых зеркал» (октябрь 2026).
    const list = [
      cand('S', 'Mary Gu – Kingdom of Crooked Mirrors (Official Lyric Video)', 'Mary Gu', 185),
      cand('F', 'Mary Gu-Королевство кривых зеркал| Премьера трека (Remix)', 'DEROSA MUSIC', 375),
      cand('K', 'СЛУШАЮ ПЯТНИЧНЫЕ НОВИНКИ 😎 #50', 'SaityLow', 8108),
    ];
    expect(pickYtCandidate(list, target)?.id).toBe('SSSSSSSSSSS');
  });

  it('видео без названия трека и не официальное — не берём', () => {
    expect(pickYtCandidate([cand('x', 'Подборка хитов октября', 'Hits', 184)], target)).toBeNull();
  });
});

describe('запасной поиск звука — треки «Популярного сейчас», которые не находились', () => {
  // Реальная выдача YouTube (октябрь 2026): первый запрос «исполнитель - название» и запасные запросы.
  const shade = { title: 'Шадэ', artist: 'By Индия, Xcho & МОТ', durationSec: 169 };
  const badTimes = { title: 'BAD TIMES', artist: 'Imael Angel', durationSec: 168 };

  it('первый запрос не дал подходящего: клип длиннее на 30 с, остальное — ремиксы, live и чужие перезаливы', () => {
    expect(pickYtCandidate(parseYtCandidates(ytShade.primary), shade)).toBeNull();
    expect(pickYtCandidate(parseYtCandidates(ytBadTimes.primary), badTimes)).toBeNull();
  });

  it('запасные запросы: основной исполнитель + название, все исполнители + название + audio, транслит', () => {
    expect(fallbackQueries(shade)).toEqual(['By Индия - Шадэ topic', 'By Индия, Xcho & МОТ Шадэ audio', 'By Indiya - Shade']);
    // Без кириллицы транслит не нужен.
    expect(fallbackQueries(badTimes)).toEqual(['Imael Angel - BAD TIMES topic', 'Imael Angel BAD TIMES audio']);
  });

  it('в выдаче запасных запросов находится официальное аудио того же трека', () => {
    expect(pickYtCandidate(parseYtCandidates(ytShade.fallback), shade, { fallback: true })?.id).toBe('dDYWjZQBgBU');
    expect(['yORJd3BWBJc', 'Hqp8vxkPrI8']).toContain(pickYtCandidate(parseYtCandidates(ytBadTimes.fallback), badTimes, { fallback: true })?.id);
  });

  it('мягче допуск: ±20 с, официальному аудио — ±30 с; клип на 30 с длиннее — нет', () => {
    const t = { ...badTimes, durationSec: 168 };
    expect(pickYtCandidate([cand('a', 'Imael Angel - BAD TIMES', 'Imael Angel', 188)], t, { fallback: true })?.id).toBe('aaaaaaaaaaa');
    expect(pickYtCandidate([cand('a', 'Imael Angel - BAD TIMES', 'Imael Angel', 189)], t, { fallback: true })).toBeNull();
    expect(pickYtCandidate([cand('o', 'Imael Angel - BAD TIMES (Official Audio)', 'Imael Angel', 198)], t, { fallback: true })?.id).toBe('ooooooooooo');
    expect(pickYtCandidate([cand('p', 'BAD TIMES', 'Imael Angel - Topic', 138, 'Provided to YouTube by DistroKid')], t, { fallback: true })?.id).toBe('ppppppppppp');
    expect(pickYtCandidate([cand('p', 'BAD TIMES', 'Imael Angel - Topic', 137)], t, { fallback: true })).toBeNull();
    const clip = parseYtCandidates(ytShade.primary).filter((c) => c.id === 'UhzVxNUvENY');
    expect(clip).toHaveLength(1);
    expect(pickYtCandidate(clip, shade, { fallback: true })).toBeNull();
  });

  it('ремиксы, ускоренные и другие песни с тем же словом в названии не подставляются', () => {
    const list = [
      cand('r', 'By Индия, Xcho, МОТ - Шадэ (ремикс)', 'Aman Future - Topic', 172, 'Provided to YouTube by DistroKid'),
      cand('s', 'By Индия & Xcho & MOT - Шадэ (speed up)', 'Bearmusik', 160),
      cand('l', 'By Индия, Xcho, Мот - Шадэ (Slowed + Reverb)', 'By Индия', 175),
      cand('o', 'by Индия - Она танцует под шадэ', 'By Индия', 169),
      cand('d', 'Шадэ Deep House', 'By Индия', 169),
      cand('z', 'Шадэ', 'Zola Shadé - Topic', 169, 'Provided to YouTube by DistroKid'),
    ];
    expect(pickYtCandidate(list, shade, { fallback: true })).toBeNull();
    // И в выдаче запасных запросов без официального аудио — только видео исполнителя с тем же названием.
    const rest = parseYtCandidates(ytShade.fallback).filter((c) => c.id !== 'dDYWjZQBgBU');
    expect(pickYtCandidate(rest, shade, { fallback: true })?.id).toBe('3vYTzzW3gck');
  });

  it('фильтры запасного поиска: мягкая длительность, название целиком, любой из исполнителей, транслит', () => {
    const filters = matchFilters(shade, 'youtube', { fallback: true });
    expect(filters.length).toBeGreaterThan(2);
    const all = filters.join('\n');
    expect(all).toContain('duration >= 149 & duration <= 189');
    expect(all).toContain('duration >= 139 & duration <= 199');
    expect(all).toMatch(/title !~= '\(\?i\).*speed\\W\+up.*'/);
    expect(all).toContain('shade');
    expect(all).toMatch(/channel ~= '\(\?i\).*xcho.*'/);
    expect(all).toMatch(/channel ~= '\(\?i\).*мот.*'/);
    // Без запасного режима — прежние строгие фильтры.
    expect(matchFilters(shade, 'youtube')).toEqual(matchFilters(shade, 'youtube', { fallback: false }));
    expect(matchFilters(shade, 'youtube').join('\n')).not.toContain('duration >= 149');
  });
});

describe('fetchCatalog', () => {
  it('собирает «Популярное сейчас»; 502 от RSS — повтор; альбомы не запрашиваются', async () => {
    let songsCalls = 0;
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('/songs.json')) {
        songsCalls++;
        if (songsCalls === 1) throw new SourceError('unavailable');
        return rssSongs;
      }
      if (url.includes('itunes.apple.com/lookup')) return lookupSongs;
      throw new Error(`неожиданный адрес ${url}`);
    });
    const res = await fetchCatalog({ fetchJson, sleep: async () => undefined, limiter: NO_LIMIT, country: 'ru' });
    expect(songsCalls).toBe(2);
    expect(res).toEqual({ chart: buildChart(parseAppleRss(rssSongs), detailsMap()), country: 'ru' });
    expect(fetchJson.mock.calls.map(([url]) => url).join(' ')).not.toMatch(/albums.json|entity=song/);
    for (const [url] of fetchJson.mock.calls) {
      expect(url).toMatch(/^https:\/\/(rss\.marketingtools\.apple\.com\/api\/v2\/ru\/music\/most-played\/100\/|itunes\.apple\.com\/lookup\?)/);
      if (url.includes('itunes')) expect(url).toContain('country=ru');
    }
  });

  it('чарт и lookup — страны из настройки (по умолчанию США)', async () => {
    const urls: string[] = [];
    const fetchJson = async (url: string) => {
      urls.push(url);
      return url.includes('/songs.json') ? rssSongs : lookupSongs;
    };
    const res = await fetchCatalog({ fetchJson, sleep: async () => undefined, limiter: NO_LIMIT, country: 'gb' });
    expect(res.country).toBe('gb');
    expect(urls.filter((u) => u.includes('rss.marketingtools'))).toEqual([expect.stringContaining('/api/v2/gb/music/most-played/100/')]);
    expect(urls.filter((u) => u.includes('itunes.apple.com/lookup')).every((u) => u.includes('country=gb'))).toBe(true);
    urls.length = 0;
    await fetchCatalog({ fetchJson, sleep: async () => undefined, limiter: NO_LIMIT });
    expect(urls.every((u) => u.includes('/us/music/') || u.includes('country=us'))).toBe(true);
  });

  it('поиск каталога — страна из настройки пользователя', async () => {
    const urls: string[] = [];
    const adapter = createCatalogAdapter({
      fetchJson: async (url: string) => {
        urls.push(url);
        return lookupSongs;
      },
      limiter: NO_LIMIT,
    });
    await adapter.search('кино', { settings: { chartCountry: 'kz' } } as SourceContext);
    expect(urls[0]).toContain('country=kz');
  });

  it('нет сети — ошибка offline без лишних повторов', async () => {
    const fetchJson = vi.fn(async () => {
      throw new SourceError('offline');
    });
    await expect(fetchCatalog({ fetchJson, sleep: async () => undefined, limiter: NO_LIMIT })).rejects.toMatchObject({ kind: 'offline' });
    expect(fetchJson.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('пустой чарт — понятная ошибка без названий чужих сервисов (R04)', async () => {
    const fetchJson = vi.fn(async () => ({ feed: { results: [] } }));
    const err = await fetchCatalog({ fetchJson, sleep: async () => undefined, limiter: NO_LIMIT }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).kind).toBe('unavailable');
    expect((err as SourceError).message).not.toMatch(/apple|itunes/i);
    expect((err as SourceError).message).toMatch(/чарт/i);
  });
});

describe('matchFilters — кандидаты для поиска одним запуском', () => {
  const target = { title: 'Королевство кривых зеркал (feat. X)', artist: 'Mary Gu & Y', durationSec: 184 };

  it('YouTube: длительность ±10 с, без чужих версий, название — или канал исполнителя', () => {
    const [byTitle, byChannel] = matchFilters(target, 'youtube');
    expect(byTitle).toContain('duration >= 174 & duration <= 194');
    expect(byTitle).toMatch(/title !~= '\(\?i\).*sped\\W\+up.*'/);
    expect(byTitle).toContain("title ~= '(?i)(?<!\\w)корол[её]вство\\W+кривых\\W+з[её]ркал(?!\\w)'");
    expect(byChannel).toContain("channel ~= '(?i)(?<!\\w)mary\\W+gu(?!\\w)'");
    // «ё» и «е» — одно: Ледяное/Ледяное с ё.
    expect(matchFilters({ title: 'Ёлка', artist: 'A' }, 'youtube')[0]).toContain('[её]лка');
  });

  it('ищем ремикс — ремиксы не отсеиваются; SoundCloud — только с длительностью и исполнителем', () => {
    expect(matchFilters({ title: 'Song (Remix)', artist: 'A', durationSec: 200 }, 'youtube')[0]).not.toMatch(/remix\|/);
    expect(matchFilters({ title: 'Song', artist: 'A' }, 'soundcloud')).toEqual([]);
    const sc = matchFilters(target, 'soundcloud');
    expect(sc).toHaveLength(2);
    expect(sc[0]).toMatch(/title ~= .*ркал.* & title ~= .*mary/);
    expect(sc[1]).toMatch(/uploader ~= .*mary/);
  });
});

describe('createCatalogAdapter', () => {
  const track: Track = {
    id: 'catalog:6823386337',
    source: 'catalog',
    sourceId: '6823386337',
    title: 'Королевство кривых зеркал',
    artist: 'Mary Gu',
    durationSec: 184,
    downloadable: true,
  };
  const ctx = (youtubeEnabled = true, soundcloudEnabled = false): SourceContext => ({
    settings: { ...defaultSettings('C:\\Music\\Aura'), youtubeEnabled, soundcloudEnabled },
    userDataDir: 'C:\\data',
  });
  /** Ответ yt-dlp на поиск одним запуском: разобранное видео со ссылкой на звук. */
  const ytHit = {
    id: 'ccccccccccc',
    title: 'Королевство кривых зеркал',
    channel: 'Mary Gu - Topic',
    duration: 185,
    description: 'Provided to YouTube by Warner',
    url: 'https://rr1.googlevideo.com/videoplayback?expire=4102444800&itag=251',
    protocol: 'https',
    acodec: 'opus',
    vcodec: 'none',
  };
  const scHit = {
    id: '2420080329',
    title: 'Mary Gu - Королевство кривых зеркал',
    uploader: 'Mary Gu',
    duration: 184.2,
    format_id: 'hls_aac_160k',
    url: 'https://playback.media-streaming.soundcloud.cloud/x/aac_160k/playlist.m3u8?expires=4102444800',
  };

  interface Opts {
    /** Ответ на поиск YouTube; функция — ответ по аргументам запуска (запросы, фильтры). */
    yt?: unknown | null | ((args: readonly string[]) => unknown);
    sc?: unknown | null | 'hang' | Error;
    now?: () => number;
  }

  function setup({ yt = ytHit, sc = null, now = () => 4102444800_000 - 3 * 3600_000 }: Opts = {}, scLimitMs = 4000) {
    const searches: { site: 'yt' | 'sc'; args: string[]; signal?: AbortSignal }[] = [];
    const run = vi.fn(async (args: readonly string[], signal?: AbortSignal, opts?: { onLine?: (l: string) => void }) => {
      const query = args.at(-1) ?? '';
      const site = query.startsWith('scsearch') ? 'sc' : 'yt';
      searches.push({ site, args: [...args], signal });
      const answer = site === 'sc' ? sc : typeof yt === 'function' ? yt(args) : yt;
      if (answer instanceof Error) throw answer;
      if (answer === 'hang') {
        await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      }
      if (answer) opts?.onLine?.(JSON.stringify(answer));
      return { stdout: '', stderr: '' };
    });
    const youtube: SourceAdapter = {
      id: 'youtube',
      search: vi.fn(),
      resolveStream: vi.fn(async (t: Track) => `https://stream.example/${t.sourceId}`),
      download: vi.fn(async (_t: Track, dest: string) => `${dest}.m4a`),
    };
    const soundcloud: SourceAdapter = {
      id: 'soundcloud',
      search: vi.fn(),
      resolveStream: vi.fn(async (t: Track) => `https://sc.example/${t.sourceId}`),
      download: vi.fn(async (_t: Track, dest: string) => `${dest}.m4a`),
    };
    let stored: unknown = null;
    const adapter = createCatalogAdapter({
      run,
      youtube,
      soundcloud,
      scLimitMs,
      now,
      readMatches: async () => stored,
      writeMatches: async (d) => {
        stored = d;
      },
    });
    return { run, searches, youtube, soundcloud, adapter, stored: () => stored };
  }

  it('поиск видео и ссылка — один запуск yt-dlp (ytsearch5 с фильтрами кандидатов), сопоставление — с пометкой источника', async () => {
    const { run, searches, youtube, adapter, stored } = setup();
    await expect(adapter.resolveStream(track, ctx())).resolves.toBe(ytHit.url);
    expect(run).toHaveBeenCalledTimes(1);
    const args = searches[0].args;
    expect(args.at(-1)).toBe('ytsearch5:Mary Gu - Королевство кривых зеркал');
    expect(args).toEqual(expect.arrayContaining(['-j', '--max-downloads', '1', '--match-filter']));
    expect(args.join(' ')).not.toMatch(/cookie|username|password|netrc/i);
    expect(youtube.resolveStream).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ matches: { 'catalog:6823386337': { source: 'youtube', id: 'ccccccccccc' } } });

    await adapter.resolveStream(track, ctx());
    expect(run).toHaveBeenCalledTimes(1); // второй раз — из кэша

    // Повторная попытка плеера: сопоставление то же, ссылка на поток — новая, через YouTube-адаптер.
    await expect(adapter.resolveStream(track, ctx(), { fresh: true })).resolves.toBe('https://stream.example/ccccccccccc');
    expect(youtube.resolveStream).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'ccccccccccc' }), expect.anything(), { fresh: true });
  });

  it('сопоставление из сохранённого файла (и прежнего формата) не ищется заново', async () => {
    const legacy = setup();
    const adapter = createCatalogAdapter({
      run: legacy.run,
      youtube: legacy.youtube,
      soundcloud: legacy.soundcloud,
      readMatches: async () => ({ version: 1, matches: { 'catalog:6823386337': { videoId: 'ccccccccccc', at: 1 } } }),
      writeMatches: async () => undefined,
    });
    await expect(adapter.resolveStream(track, ctx(true, true))).resolves.toBe('https://stream.example/ccccccccccc');
    expect(legacy.run).not.toHaveBeenCalled();
  });

  it('звук не нашёлся — понятная ошибка', async () => {
    const { adapter } = setup({ yt: null });
    await expect(adapter.resolveStream(track, ctx())).rejects.toMatchObject({ message: CATALOG_NOT_FOUND_MESSAGE });
  });

  it('обычный трек находится первым запросом: один запуск yt-dlp, запасной поиск не нужен', async () => {
    const { run, searches, adapter } = setup();
    await expect(adapter.resolveStream(track, ctx())).resolves.toBe(ytHit.url);
    expect(run).toHaveBeenCalledTimes(1);
    expect(searches[0].args.filter((a) => a.startsWith('ytsearch'))).toEqual(['ytsearch5:Mary Gu - Королевство кривых зеркал']);
  });

  it('первый запрос ничего не дал — запасные запросы одним запуском, мягче фильтры; находится «Шадэ»', async () => {
    const shade: Track = { ...track, id: 'catalog:6766252279', sourceId: '6766252279', title: 'Шадэ', artist: 'By Индия, Xcho & МОТ', durationSec: 169 };
    const { run, searches, adapter, stored } = setup({ yt: (args: readonly string[]) => (args.includes('ytsearch5:By Индия, Xcho & МОТ - Шадэ') ? null : ytShade.hit) });
    await expect(adapter.resolveStream(shade, ctx())).resolves.toBe(ytShade.hit.url);
    expect(run).toHaveBeenCalledTimes(2);
    expect(searches[1].args.filter((a) => a.startsWith('ytsearch'))).toEqual([
      'ytsearch5:By Индия - Шадэ topic',
      'ytsearch5:By Индия, Xcho & МОТ Шадэ audio',
      'ytsearch5:By Indiya - Shade',
    ]);
    expect(searches[1].args.join(' ')).toContain('duration >= 149 & duration <= 189');
    expect(stored()).toMatchObject({ matches: { 'catalog:6766252279': { source: 'youtube', id: 'dDYWjZQBgBU' } } });
  });

  it('«BAD TIMES»: первый запрос дал чужое видео — запасной поиск находит официальное аудио', async () => {
    const bad: Track = { ...track, id: 'catalog:1894224409', sourceId: '1894224409', title: 'BAD TIMES', artist: 'Imael Angel', durationSec: 168 };
    // Перезалив с другим названием прошёл бы фильтр канала — проверка найденного его отсеивает.
    const foreign = { ...ytBadTimes.hit, id: 'fdjBmaULmfs', title: 'Imael Angel – Bad Times (Official Video) DDD TikTok Viral', channel: 'Nov Music', duration: 204, description: '' };
    const { run, adapter } = setup({ yt: (args: readonly string[]) => (args.includes('ytsearch5:Imael Angel - BAD TIMES') ? foreign : ytBadTimes.hit) });
    await expect(adapter.resolveStream(bad, ctx())).resolves.toBe(ytBadTimes.hit.url);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('отказ «звук не найден» помнится не дольше 10 минут, «Повторить» (fresh) ищет заново сразу', async () => {
    let clock = 4102444800_000 - 3 * 3600_000;
    const { run, adapter } = setup({ yt: null, now: () => clock });
    await expect(adapter.resolveStream(track, ctx())).rejects.toMatchObject({ message: CATALOG_NOT_FOUND_MESSAGE });
    const afterFirst = run.mock.calls.length;
    expect(afterFirst).toBe(2); // первый запрос и запасной

    clock += 9 * 60_000;
    await expect(adapter.resolveStream(track, ctx())).rejects.toMatchObject({ message: CATALOG_NOT_FOUND_MESSAGE });
    expect(run).toHaveBeenCalledTimes(afterFirst); // из памяти отказа

    await expect(adapter.resolveStream(track, ctx(), { fresh: true })).rejects.toMatchObject({ message: CATALOG_NOT_FOUND_MESSAGE });
    expect(run).toHaveBeenCalledTimes(afterFirst * 2); // «Повторить» — новый поиск

    clock += 10 * 60_000 + 1;
    await expect(adapter.resolveStream(track, ctx())).rejects.toMatchObject({ message: CATALOG_NOT_FOUND_MESSAGE });
    expect(run).toHaveBeenCalledTimes(afterFirst * 3); // отказ устарел — ищется снова
  });

  it('SoundCloud первым: полная версия нашлась — играет оттуда, YouTube отменяется; скачивание — тоже с SoundCloud', async () => {
    const { searches, soundcloud, youtube, adapter, stored } = setup({ sc: scHit, yt: 'hang' });
    await expect(adapter.resolveStream(track, ctx(true, true))).resolves.toBe(scHit.url);
    const sc = searches.find((s) => s.site === 'sc')!;
    expect(sc.args.at(-1)).toBe('scsearch8:Mary Gu Королевство кривых зеркал');
    expect(sc.args).toContain('--match-filter');
    expect(searches.find((s) => s.site === 'yt')?.signal?.aborted).toBe(true);
    expect(stored()).toMatchObject({ matches: { 'catalog:6823386337': { source: 'soundcloud', id: '2420080329' } } });

    const signal = new AbortController().signal;
    await adapter.download!(track, 'C:\\m\\a.part', ctx(true, true), () => {}, signal);
    expect(soundcloud.download).toHaveBeenCalledWith(expect.objectContaining({ source: 'soundcloud', sourceId: '2420080329' }), 'C:\\m\\a.part', expect.anything(), expect.any(Function), signal);
    expect(youtube.download).not.toHaveBeenCalled();
  });

  it('SoundCloud не ответил за короткий предел — играет YouTube, старт не ждёт дольше предела', async () => {
    const { searches, adapter, stored } = setup({ sc: 'hang' }, 60);
    const started = Date.now();
    await expect(adapter.resolveStream(track, ctx(true, true))).resolves.toBe(ytHit.url);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(searches.find((s) => s.site === 'sc')?.signal?.aborted).toBe(true);
    expect(stored()).toMatchObject({ matches: { 'catalog:6823386337': { source: 'youtube' } } });
  });

  it('SoundCloud просто не успел за короткий предел — следующий трек снова ищется на SoundCloud', async () => {
    const { searches, adapter } = setup({ sc: 'hang' }, 60);
    await adapter.resolveStream(track, ctx(true, true));
    const other: Track = { ...track, id: 'catalog:2', sourceId: '2' };
    await adapter.resolveStream(other, ctx(true, true));
    expect(searches.filter((s) => s.site === 'sc')).toHaveLength(2);
  });

  it.each([
    ['нет сети', 'ERROR: Unable to download JSON metadata: <urlopen error [Errno 11001] getaddrinfo failed>'],
    ['403', 'ERROR: [soundcloud:search] Unable to download JSON metadata: HTTP Error 403: Forbidden'],
  ])('SoundCloud: %s — следующие треки несколько минут его не ждут (сразу YouTube)', async (_name, stderr) => {
    const { searches, adapter } = setup({ sc: new YtDlpError('failed', 'yt-dlp завершился с ошибкой', stderr) });
    await expect(adapter.resolveStream(track, ctx(true, true))).resolves.toBe(ytHit.url);
    const other: Track = { ...track, id: 'catalog:2', sourceId: '2' };
    await adapter.resolveStream(other, ctx(true, true));
    expect(searches.filter((s) => s.site === 'sc')).toHaveLength(1);
  });

  it('прочий сбой SoundCloud (5xx) — играет YouTube, SoundCloud не выключается', async () => {
    const { searches, adapter } = setup({ sc: new YtDlpError('failed', 'yt-dlp завершился с ошибкой', 'ERROR: HTTP Error 502: Bad Gateway') });
    await expect(adapter.resolveStream(track, ctx(true, true))).resolves.toBe(ytHit.url);
    const other: Track = { ...track, id: 'catalog:2', sourceId: '2' };
    await adapter.resolveStream(other, ctx(true, true));
    expect(searches.filter((s) => s.site === 'sc')).toHaveLength(2);
  });

  it('проверка звука (волна): ссылка поиска не отдаёт звук — звук берёт адаптер YouTube (с проверкой)', async () => {
    const base = setup();
    const adapter = createCatalogAdapter({
      run: base.run,
      youtube: base.youtube,
      soundcloud: base.soundcloud,
      probe: async () => false,
      readMatches: async () => null,
      writeMatches: async () => undefined,
      now: () => 4102444800_000 - 3 * 3600_000,
    });
    await expect(adapter.resolveStream(track, ctx(), { verify: true })).resolves.toBe('https://stream.example/ccccccccccc');
    expect(base.youtube.resolveStream).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'ccccccccccc' }), expect.anything(), { verify: true });
  });

  it('на SoundCloud нет полной версии — YouTube', async () => {
    const { adapter } = setup({ sc: null });
    await expect(adapter.resolveStream(track, ctx(true, true))).resolves.toBe(ytHit.url);
  });

  it('отмена подготовки (пользователь пролистал) убивает поиск', async () => {
    const { searches, adapter } = setup({ yt: 'hang', sc: 'hang' });
    const controller = new AbortController();
    const pending = adapter.resolveStream(track, ctx(true, true), { signal: controller.signal });
    await vi.waitFor(() => expect(searches).toHaveLength(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(searches.every((s) => s.signal?.aborted)).toBe(true);
  });

  it('YouTube и SoundCloud выключены — подсказка включить, yt-dlp не запускается', async () => {
    const { adapter, run } = setup();
    await expect(adapter.resolveStream(track, ctx(false, false))).rejects.toMatchObject({ kind: 'disabled', message: CATALOG_NEEDS_YOUTUBE_MESSAGE });
    await expect(adapter.download!(track, 'C:\\m\\a.part', ctx(false, false), () => {}, new AbortController().signal)).rejects.toMatchObject({
      message: CATALOG_NEEDS_YOUTUBE_MESSAGE,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('YouTube выключен, на SoundCloud полной версии нет — подсказка включить YouTube', async () => {
    const { adapter, searches } = setup({ sc: null });
    await expect(adapter.resolveStream(track, ctx(false, true))).rejects.toMatchObject({ message: CATALOG_NEEDS_YOUTUBE_MESSAGE });
    expect(searches.map((s) => s.site)).toEqual(['sc']);
  });

  it('скачивание — через YouTube-адаптер (m4a) в переданный *.part', async () => {
    const { adapter, youtube } = setup();
    const signal = new AbortController().signal;
    await expect(adapter.download!(track, 'C:\\m\\a.part', ctx(), () => {}, signal)).resolves.toBe('C:\\m\\a.part.m4a');
    expect(youtube.download).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'youtube', sourceId: 'ccccccccccc' }),
      'C:\\m\\a.part',
      expect.anything(),
      expect.any(Function),
      signal,
    );
  });
});
