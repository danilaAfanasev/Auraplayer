import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../shared/types';
import dzPlaylistSearch from './sources/__fixtures__/deezer-playlist-search.json';
import dzPlaylistTracks from './sources/__fixtures__/deezer-playlist-tracks.json';
import dzRadio from './sources/__fixtures__/deezer-radio-shadowraze.json';
import dzTop from './sources/__fixtures__/deezer-top-shadowraze.json';
import dzArtistSearch from './sources/__fixtures__/deezer-artist-search-shadowraze.json';
import ytMixMadk1d from './sources/__fixtures__/youtube-mix-madk1d.json';
import ytMix from './sources/__fixtures__/youtube-mix-shadowraze.json';
import scRelated from './sources/__fixtures__/soundcloud-related.json';
import ytSearchMadk1d from './sources/__fixtures__/youtube-search-madk1d.json';
import { SourceError } from './sources/types';
import { emptyWaveMemory, pickWaveTracks, primaryArtist, rememberTracks, scriptOf } from '../shared/wave';
import { createWaveService, isSongLike, mixUrl, parseDeezerTracks, parseYtMix } from './wave';

const SEED_VIDEO = '89yDiQ8WkNg'; // shadowraze — astral step

const ytTrack = (id: string, artist = 'shadowraze', title = 'astral step'): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title,
  artist,
  downloadable: true,
});

const catalogTrack = (id: string, artist: string, title: string, durationSec?: number): Track => ({
  id: `catalog:${id}`,
  source: 'catalog',
  sourceId: id,
  title,
  artist,
  downloadable: true,
  ...(durationSec ? { durationSec } : {}),
});

const ok = (json: unknown) => ({ stdout: JSON.stringify(json), stderr: '' });

describe('parseYtMix', () => {
  it('Mix трека — треки YouTube без самого трека и без повторов', () => {
    const tracks = parseYtMix(ytMix, SEED_VIDEO);
    expect(tracks.length).toBeGreaterThan(20);
    expect(tracks.every((t) => t.source === 'youtube' && t.id === `youtube:${t.sourceId}`)).toBe(true);
    expect(tracks.some((t) => t.sourceId === SEED_VIDEO)).toBe(false);
    expect(new Set(tracks.map((t) => t.id)).size).toBe(tracks.length);
    const artists = tracks.map((t) => t.artist);
    expect(artists).toContain('INTERWORLD, zxcursed, Sadfriendd');
    expect(artists).toContain('BUSHIDO ZHO');
    // автоканал «… - Topic» — исполнитель
    expect(tracks.find((t) => t.sourceId === 'DAgEu_A0zHk')).toMatchObject({ artist: 'shadowraze', title: '1000-7' });
  });

  it('Mix трека madk1d — тот же круг исполнителей', () => {
    const artists = parseYtMix(ytMixMadk1d, 'J7NFL-eOxiQ').map((t) => t.artist);
    expect(artists).toEqual(expect.arrayContaining(['madk1d, VILLIAN', 'VILLIAN', 'FORTUNA 812', 'CUPSIZE']));
  });

  it('нетрековые видео (интервью на 3 часа, «ТОП 10 песен») отсекаются', () => {
    const titles = parseYtMix(ytSearchMadk1d).map((t) => t.title);
    expect(titles).toEqual(['ДИНАСТИЯ (official music video)', '8 миля (official music video)', 'дырки в штанах (music video)']);
  });
});

describe('isSongLike', () => {
  it('по длительности и названию', () => {
    expect(isSongLike({ title: 'Bandana', artist: 'Big Baby Tape', durationSec: 152 })).toBe(true);
    expect(isSongLike({ title: 'Секрет или тайна (Remix)', artist: 'УННВ', durationSec: 129 })).toBe(true);
    expect(isSongLike({ title: '1 HOUR MIX - Most Viral Phonk', artist: 'NTL Funk', durationSec: 3646 })).toBe(false);
    expect(isSongLike({ title: 'Phonk Mix 2026', artist: 'X', durationSec: 300 })).toBe(false);
    expect(isSongLike({ title: 'плейлист чтобы вспомнить ту самую зиму', artist: 'yancy', durationSec: 500 })).toBe(false);
    expect(isSongLike({ title: 'Интро', artist: 'X', durationSec: 20 })).toBe(false);
    expect(isSongLike({ title: 'Без длительности', artist: 'X' })).toBe(true);
  });

  it('длиннее 8 минут — только официальное аудио; нижний предел 60 с остаётся', () => {
    expect(isSongLike({ title: 'Long suite', artist: 'X', durationSec: 700 })).toBe(false);
    expect(isSongLike({ title: 'Long suite', artist: 'X', durationSec: 700, official: true })).toBe(true);
    expect(isSongLike({ title: 'Интервью', artist: 'X', durationSec: 200, official: true })).toBe(false);
    expect(isSongLike({ title: 'Song (Radio Mix)', artist: 'X', durationSec: 200 })).toBe(true);
    expect(isSongLike({ title: 'Короткий', artist: 'X', durationSec: 59, official: true })).toBe(false);
  });

  it('ускоренные, замедленные и прочие переделки — не песни для волны', () => {
    expect(isSongLike({ title: 'POWER - Slowed + Reverb', artist: 'CRYDE UMRIZ', durationSec: 150 })).toBe(false);
    expect(isSongLike({ title: 'я сохраню (speed up)', artist: 'Cold Carti', durationSec: 99 })).toBe(false);
    expect(isSongLike({ title: 'BLACK ZONE (ultra slowed)', artist: 'VLCNRSH', durationSec: 140 })).toBe(false);
    expect(isSongLike({ title: 'internet l0ve nightcore', artist: 'gitarakuru', durationSec: 140 })).toBe(false);
    expect(isSongLike({ title: 'Escort (Instrumental, Slowed)', artist: 'GROWORG', durationSec: 140 })).toBe(false);
    // «boosted»-переделки и фонк-ремиксы чужих треков — тоже (звука для них часто нет вовсе).
    expect(isSongLike({ title: 'help_urself (boosted)', artist: 'x', durationSec: 150 })).toBe(false);
    expect(isSongLike({ title: 'Kosandra (Phonk Remix)', artist: 'DJ X', durationSec: 150 })).toBe(false);
    expect(isSongLike({ title: 'Минимал фонк ремикс', artist: 'DJ X', durationSec: 150 })).toBe(false);
    expect(isSongLike({ title: 'Sonne (Super Bass Boosted)', artist: 'X', durationSec: 250 })).toBe(false);
    expect(isSongLike({ title: 'Секрет или тайна (Remix)', artist: 'УННВ', durationSec: 129 })).toBe(true);
  });

  it('волна по артистам не берёт переделки из радио', async () => {
    const fetchJson = fakeFetch({
      '/search/artist?q=shadowraze': dzArtistSearch,
      '/artist/126239552/top': dzTop,
      '/artist/126239552/radio': dzRadio,
    });
    const wave = createWaveService({ run: vi.fn(), fetchJson });
    const titles = (await wave.start({ title: 'x', artists: ['shadowraze'] }, settings)).map((t) => t.title);
    expect(titles).toContain('Бесконечный магазин');
    expect(titles).not.toContain('я сохраню (speed up)');
  });
});

describe('parseDeezerTracks', () => {
  it('радио артиста — треки каталога: звук ищется на YouTube по исполнителю, названию и длительности', () => {
    const tracks = parseDeezerTracks(dzRadio);
    expect(tracks).toHaveLength(25);
    expect(tracks[0]).toEqual({
      id: 'catalog:dz2786166682',
      source: 'catalog',
      sourceId: 'dz2786166682',
      title: '44',
      artist: 'shadowraze',
      album: '44',
      durationSec: 140,
      coverUrl: expect.stringMatching(/^https:\/\/cdn-images\.dzcdn\.net\/.+1000x1000/),
      downloadable: true,
    });
    expect(tracks.map((t) => t.artist)).toEqual(expect.arrayContaining(['тёмный принц', 'madk1d', 'FORTUNA 812', 'Хаски']));
  });

  it('мусор и ответ с ошибкой — пустой список', () => {
    expect(parseDeezerTracks({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } })).toEqual([]);
    expect(parseDeezerTracks({ data: [null, { id: 1, title: '' }, { type: 'artist', id: 2, name: 'x' }] })).toEqual([]);
  });
});

/** Ответы открытого API по адресу запроса. */
function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const [part, json] of Object.entries(routes)) if (url.includes(part)) return json;
    throw new SourceError('unavailable', `нет образца для ${url}`);
  });
}

const settings = { youtubeEnabled: true };

describe('createWaveService', () => {
  it('волна по треку YouTube — его Mix через yt-dlp, анонимно и с ограничением длины', async () => {
    const run = vi.fn(async (_args: readonly string[]) => ok(ytMix));
    const wave = createWaveService({ run, fetchJson: fakeFetch({}), random: () => 0 });
    const tracks = await wave.start({ title: 'astral step', lead: [ytTrack(SEED_VIDEO)], tracks: [ytTrack(SEED_VIDEO)] }, settings);
    expect(run).toHaveBeenCalledTimes(1);
    const args = run.mock.calls[0][0];
    expect(args).toContain('--flat-playlist');
    expect(args).toContain('--playlist-end');
    expect(args[args.length - 1]).toBe(mixUrl(SEED_VIDEO));
    expect(mixUrl(SEED_VIDEO)).toBe(`https://www.youtube.com/watch?v=${SEED_VIDEO}&list=RD${SEED_VIDEO}`);
    expect(tracks.length).toBeGreaterThanOrEqual(20); // не больше 3 треков одного исполнителя
    expect(tracks.some((t) => t.sourceId === SEED_VIDEO)).toBe(false);
  });

  it('волна по треку каталога — сначала видео трека (сохранённое сопоставление), потом его Mix', async () => {
    const run = vi.fn(async (_args: readonly string[]) => ok(ytMix));
    const wave = createWaveService({
      run,
      fetchJson: fakeFetch({}),
      readMatches: async () => ({ version: 1, matches: { 'catalog:1537289862': { videoId: SEED_VIDEO, at: 1 } } }),
    });
    const seed = catalogTrack('1537289862', 'shadowraze', 'astral step', 122);
    const tracks = await wave.start({ title: 'astral step', lead: [seed], tracks: [seed] }, settings);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].at(-1)).toBe(mixUrl(SEED_VIDEO));
    expect(tracks.length).toBeGreaterThanOrEqual(20);
  });

  it('волна по треку каталога: сопоставление нового формата (с пометкой источника) — его видео; звук с SoundCloud — поиск видео', async () => {
    const run = vi.fn(async (_args: readonly string[]) => ok(ytMix));
    const wave = createWaveService({
      run,
      fetchJson: fakeFetch({}),
      readMatches: async () => ({ version: 1, matches: { 'catalog:1': { source: 'youtube', id: SEED_VIDEO, at: 1 }, 'catalog:2': { source: 'soundcloud', id: '123', at: 1 } } }),
    });
    const first = catalogTrack('1', 'shadowraze', 'astral step', 122);
    await wave.start({ title: 'x', lead: [first], tracks: [first] }, settings);
    expect(run.mock.calls[0][0].at(-1)).toBe(mixUrl(SEED_VIDEO));
    const second = catalogTrack('2', 'shadowraze', 'astral step', 122);
    await wave.start({ title: 'x', lead: [second], tracks: [second] }, settings).catch(() => undefined);
    expect(String(run.mock.calls[1][0].at(-1))).toMatch(/^ytsearch/);
  });

  it('волна по своему файлу — видео ищется на YouTube по «исполнитель — название» и длительности', async () => {
    const run = vi.fn(async (args: readonly string[]) => (String(args.at(-1)).startsWith('ytsearch') ? ok(ytSearchMadk1d) : ok(ytMixMadk1d)));
    const wave = createWaveService({ run, fetchJson: fakeFetch({}), readMatches: async () => null });
    const local: Track = { id: 'local:C:/m/8.mp3', source: 'local', sourceId: 'C:/m/8.mp3', title: '8 миля', artist: 'madk1d', durationSec: 118, downloadable: false };
    const tracks = await wave.start({ title: '8 миля', lead: [local], tracks: [local] }, settings);
    expect(run.mock.calls[0][0].at(-1)).toMatch(/^ytsearch\d+:madk1d - 8 миля$/);
    expect(run.mock.calls[1][0].at(-1)).toBe(mixUrl('N9ZjkSrsZRA'));
    expect(tracks.map((t) => t.artist)).toContain('CUPSIZE');
  });

  it('волна по артистам — их треки и радио похожих, вперемешку', async () => {
    const fetchJson = fakeFetch({
      '/search/artist?q=shadowraze': dzArtistSearch,
      '/artist/126239552/top': dzTop,
      '/artist/126239552/radio': dzRadio,
    });
    const run = vi.fn();
    const wave = createWaveService({ run, fetchJson, random: () => 0 });
    const tracks = await wave.start({ title: 'Дота-рэп', artists: ['shadowraze'] }, settings);
    expect(run).not.toHaveBeenCalled();
    const artists = tracks.map((t) => t.artist);
    expect(artists.slice(0, 4)).toContain('shadowraze');
    expect(artists).toEqual(expect.arrayContaining(['shadowraze', 'тёмный принц', 'madk1d']));
    expect(tracks.every((t) => t.source === 'catalog')).toBe(true);
  });

  it('волна по жанру — подборки по запросу', async () => {
    const fetchJson = fakeFetch({ '/search/playlist?q=hyperpop': dzPlaylistSearch, '/playlist/': dzPlaylistTracks });
    const wave = createWaveService({ run: vi.fn(), fetchJson, random: () => 0 });
    const tracks = await wave.start({ title: 'Хайперпоп', queries: ['hyperpop'] }, settings);
    expect(tracks.map((t) => t.artist)).toEqual(expect.arrayContaining(['100 gecs', 'Charli xcx']));
  });

  it('«Своя волна»: текст, совпавший с артистом, — волна артиста', async () => {
    const fetchJson = fakeFetch({
      '/search/artist?q=shadowraze': dzArtistSearch,
      '/artist/126239552/top': dzTop,
      '/artist/126239552/radio': dzRadio,
    });
    const wave = createWaveService({ run: vi.fn(), fetchJson });
    const tracks = await wave.start({ title: 'shadowraze', text: 'shadowraze' }, settings);
    expect(tracks.map((t) => t.artist)).toContain('тёмный принц');
    expect(fetchJson.mock.calls.some(([url]) => String(url).includes('/search/playlist'))).toBe(false);
  });

  it('дополнение: следующий Mix — от недавно сыгранного трека', async () => {
    const run = vi.fn(async (_args: readonly string[]) => ok(ytMixMadk1d));
    const wave = createWaveService({ run, fetchJson: fakeFetch({}), random: () => 0 });
    const recent = [ytTrack('J7NFL-eOxiQ', 'VILLIAN, madk1d', 'ДИНАСТИЯ')];
    const tracks = await wave.more({ seed: { title: 'Моя волна', tracks: recent }, recent, round: 0 }, settings);
    expect(run.mock.calls[0][0].at(-1)).toBe(mixUrl('J7NFL-eOxiQ'));
    expect(tracks.map((t) => t.artist)).toContain('FORTUNA 812');
  });

  it('дополнение: Mix не удался — радио исполнителя недавнего трека', async () => {
    const run = vi.fn(async () => {
      throw new SourceError('unavailable', 'YouTube не отвечает');
    });
    const fetchJson = fakeFetch({
      '/search/artist?q=shadowraze': dzArtistSearch,
      '/artist/126239552/top': dzTop,
      '/artist/126239552/radio': dzRadio,
    });
    const wave = createWaveService({ run, fetchJson, random: () => 0 });
    const recent = [ytTrack(SEED_VIDEO)];
    const tracks = await wave.more({ seed: { title: 'astral step', tracks: recent }, recent, round: 0 }, settings);
    expect(tracks.map((t) => t.artist)).toContain('тёмный принц');
  });

  it('YouTube выключен — волне по треку брать похожие неоткуда: понятная ошибка', async () => {
    const wave = createWaveService({ run: vi.fn(), fetchJson: fakeFetch({}) });
    const seed = ytTrack(SEED_VIDEO);
    await expect(wave.start({ title: 'x', lead: [seed], tracks: [seed] }, { youtubeEnabled: false })).rejects.toThrow(/YouTube/);
  });
});

describe('похожие артисты источника и зарубежное похожее', () => {
  const NOW_2026 = () => Date.UTC(2026, 9, 29);
  const dzTrack = (id: number, artist: string, title: string, albumId = 900 + id) => ({
    id,
    type: 'track',
    title,
    duration: 180,
    artist: { id: 5000 + id, name: artist },
    album: { id: albumId, title },
  });
  /** Похожие артисты Платины — разные сцены, без фильтра языка. */
  const related = { data: [{ id: 101, name: 'Travis Scott', nb_fan: 3000000 }, { id: 102, name: 'Pharaoh', nb_fan: 90000 }] };
  const platinaRoutes = {
    '/search/artist?q=%D0%9F%D0%BB%D0%B0%D1%82%D0%B8%D0%BD%D0%B0': { data: [{ id: 14097523, name: 'Платина', nb_fan: 36405 }] },
    '/artist/14097523/top': { data: [dzTrack(1, 'Платина', 'Иней!', 865683242), dzTrack(2, 'Платина', 'Бассок'), dzTrack(3, 'Платина', 'Хенни'), dzTrack(4, 'Платина', 'Групи')] },
    '/artist/14097523/radio': {
      data: [
        dzTrack(10, 'Платина', 'Санта Клаус'),
        dzTrack(11, 'Платина', 'Сердце'),
        dzTrack(12, 'Платина', 'Бро'),
        ...Array.from({ length: 12 }, (_, i) => dzTrack(20 + i, `Русский ${i}`, `Песня ${i}`)),
      ],
    },
    '/artist/14097523/related': related,
    '/artist/101/top': { data: [dzTrack(40, 'Travis Scott', 'FE!N'), dzTrack(41, 'Travis Scott', 'SICKO MODE')] },
    '/artist/102/top': { data: [dzTrack(42, 'Pharaoh', 'Дико, например'), dzTrack(43, 'Pharaoh', 'Black Siemens')] },
    '/album/865683242': { id: 865683242, genre_id: 116, genres: { data: [{ id: 116, name: 'Rap/Hip Hop' }] } },
    '/search/playlist?q=hip%20hop%202026': dzPlaylistSearch,
    '/playlist/': dzPlaylistTracks,
  };

  it('волна по артисту — и топы его «похожих артистов» источника (без фильтра языка)', async () => {
    const wave = createWaveService({ run: vi.fn(), fetchJson: fakeFetch(platinaRoutes), random: () => 0, now: NOW_2026 });
    const tracks = await wave.start({ title: 'Платина', artists: ['Платина'] }, settings);
    const artists = tracks.map((t) => t.artist);
    expect(artists).toEqual(expect.arrayContaining(['Travis Scott', 'Pharaoh', 'Русский 0']));
  });

  it('за порцию — не больше 3 кандидатов от одного исполнителя', async () => {
    const wave = createWaveService({ run: vi.fn(), fetchJson: fakeFetch(platinaRoutes), random: () => 0, now: NOW_2026 });
    const tracks = await wave.start({ title: 'Платина', artists: ['Платина'] }, settings);
    expect(tracks.filter((t) => primaryArtist(t) === 'платина').length).toBeLessThanOrEqual(3);
    expect(tracks.filter((t) => primaryArtist(t) === 'платина').length).toBeGreaterThan(0);
  });

  it('жанр артиста по-английски («Rap/Hip Hop» → подборки «hip hop 2026») — зарубежные кандидаты', async () => {
    const fetchJson = fakeFetch(platinaRoutes);
    const wave = createWaveService({ run: vi.fn(), fetchJson, random: () => 0, now: NOW_2026 });
    const tracks = await wave.start({ title: 'Платина', artists: ['Платина'] }, settings);
    expect(fetchJson.mock.calls.some(([url]) => String(url).includes('/search/playlist?q=hip%20hop%202026'))).toBe(true);
    expect(tracks.map((t) => t.artist)).toEqual(expect.arrayContaining(['100 gecs']));
  });

  it('подмешанное зарубежное — приправа, а не сид: дополнение не ищет похожих на него (волна не уплывает в чужую сцену)', async () => {
    const fetchJson = fakeFetch(platinaRoutes);
    const wave = createWaveService({ run: vi.fn(), fetchJson, random: () => 0, now: NOW_2026 });
    const first = await wave.start({ title: 'Платина', artists: ['Платина'] }, settings);
    const spice = first.find((t) => t.artist === '100 gecs')!;
    const own = first.find((t) => t.artist === 'Платина')!;
    expect(spice && own).toBeTruthy();
    fetchJson.mockClear();
    // Раунд 2 — радио исполнителя недавнего трека; недавние — подмешанный зарубежный и свой.
    await wave.more({ seed: { title: 'Платина', artists: ['Платина'] }, recent: [spice, own], round: 2 }, settings);
    const urls = fetchJson.mock.calls.map(([url]) => decodeURIComponent(String(url)));
    expect(urls.some((u) => u.includes('search/artist?q=100 gecs'))).toBe(false);
  });

  it('подборка жанра: сначала с запросом в названии, подборки-настроения (lofi, chill, sleep) для жанра не берутся', async () => {
    const search = {
      data: [
        { id: 7917934722, type: 'playlist', title: 'Late Night Vibes - Chillhop / Ambient / Lofi Hip Hop', user: { name: 'Chillhop Music' } },
        { id: 1579491945, type: 'playlist', title: 'Hip Hop 2026', user: { name: 'Filtr Sweden' } },
        { id: 1677006641, type: 'playlist', title: 'Hot Urban', user: { name: 'Ayoub - Deezer Rap Editor' } },
      ],
    };
    const fetchJson = fakeFetch({ '/search/playlist?q=hip%20hop%202026': search, '/playlist/': dzPlaylistTracks });
    const wave = createWaveService({ run: vi.fn(), fetchJson, random: () => 0 });
    await wave.start({ title: 'Хип-хоп', queries: ['hip hop 2026'] }, settings);
    const playlistCalls = fetchJson.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/playlist/'));
    expect(playlistCalls).toHaveLength(1);
    // «Hip Hop 2026» — весь запрос в названии; редакторская «Hot Urban» — следом.
    expect(playlistCalls[0]).toContain('/playlist/1579491945/');
    expect(playlistCalls.some((u) => u.includes('7917934722'))).toBe(false);
  });

  it('подборка редкого жанра: сначала те, где в названии весь запрос («Witch House»), а не редакторская «House Party»', async () => {
    const search = {
      data: [
        { id: 7497148344, type: 'playlist', title: 'House Party with Tiësto', user: { name: 'Deezer By Artists' } },
        { id: 9815830762, type: 'playlist', title: 'Witch House', user: { name: 'Kayleigh-Jade West' } },
        { id: 1111111111, type: 'playlist', title: 'Witch-House Essentials', user: { name: 'Georges - Deezer Electronic Editor' } },
      ],
    };
    const fetchJson = fakeFetch({ '/search/playlist?q=witch%20house': search, '/playlist/': dzPlaylistTracks });
    const wave = createWaveService({ run: vi.fn(), fetchJson, random: () => 0 });
    await wave.start({ title: 'Витч-хаус', queries: ['witch house'] }, settings);
    const playlistCalls = fetchJson.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/playlist/'));
    expect(playlistCalls[0]).toContain('/playlist/1111111111/');
  });

  it('волна по русскому треку: Mix трека и зарубежное похожее — в 30 треках волны хотя бы 20 % другой письменности', async () => {
    const run = vi.fn(async (_args: readonly string[]) => ok(ytMixMadk1d));
    const wave = createWaveService({ run, fetchJson: fakeFetch(platinaRoutes), random: () => 0, now: NOW_2026 });
    const lead = ytTrack('aaaaaaaaaaa', 'Платина', 'Иней!');
    const candidates = await wave.start({ title: 'Иней!', lead: [lead], tracks: [lead] }, settings);
    let memory = rememberTracks(emptyWaveMemory(), [lead]);
    const picked: Track[] = [];
    for (const batch of [15, 14]) {
      const r = pickWaveTracks(candidates, memory, batch);
      picked.push(...r.picked);
      memory = r.memory;
    }
    const waveTracks = [lead, ...picked];
    expect(waveTracks).toHaveLength(30);
    expect(waveTracks.filter((t) => scriptOf(t) !== 'cyrillic').length).toBeGreaterThanOrEqual(6);
    expect(candidates.some((t) => t.artist === '100 gecs')).toBe(true);
    // Зарубежные вкраплены в список (каждый пятый), а не в хвост: русские исполнители с латинскими названиями
    // письменностью не отличить от зарубежных, и хвост мог бы не дойти до очереди.
    const playlistArtists = new Set((dzPlaylistTracks as { data: { artist: { name: string } }[] }).data.map((t) => t.artist.name));
    expect(candidates.slice(0, 10).filter((t) => playlistArtists.has(t.artist)).length).toBeGreaterThanOrEqual(2);
    expect(waveTracks.filter((t) => playlistArtists.has(t.artist)).length).toBeGreaterThanOrEqual(5);
  });
});

describe('выбор артистов сида (артисты «Моей волны» — по убыванию рейтинга)', () => {
  const ARTISTS = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J10', 'K11', 'L12'];

  /** Каких артистов волна взяла в первую порцию: по запросам поиска артиста. */
  async function chosen(random: () => number): Promise<string[]> {
    const fetchJson = vi.fn(async (_url: string) => ({ data: [] }));
    const wave = createWaveService({ run: vi.fn(), fetchJson, random });
    await wave.start({ title: 'Моя волна', artists: ARTISTS }, settings).catch(() => undefined);
    return fetchJson.mock.calls
      .map(([url]) => /\/search\/artist\?q=([^&]+)/.exec(String(url))?.[1])
      .filter((n): n is string => !!n)
      .map(decodeURIComponent);
  }

  it('random всегда 0 — пять первых по рейтингу (шире, чем раньше: больше разных исполнителей за порцию)', async () => {
    expect((await chosen(() => 0)).sort()).toEqual(['A1', 'B2', 'C3', 'D4', 'E5']);
  });

  it('раньше в списке — выбирается чаще; пять разных артистов за раз', async () => {
    let state = 12345;
    const lcg = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const count = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const names = await chosen(lcg);
      expect(new Set(names).size).toBe(5);
      for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
    }
    const c = (n: string) => count.get(n) ?? 0;
    expect(c('A1')).toBeGreaterThan(c('C3'));
    expect(c('C3')).toBeGreaterThan(c('L12'));
    expect(c('A1')).toBeGreaterThan(2 * c('L12'));
    expect(c('L12')).toBeGreaterThan(0); // и последний иногда попадает
  });
});

describe('волна SoundCloud — рекомендации SoundCloud к треку', () => {
  /** Рекомендации образца: полные треки (DRM отсеяны) — разобраны вручную. */
  const RELATED_OPEN_IDS = ['1578316566', '2426052057', '2059950520', '1491542173', '2402524998', '2366065991', '2409114774', '1819446642', '2410991442'];
  const scTrack = (id: string, page: string): Track => ({
    id: `soundcloud:${id}`,
    source: 'soundcloud',
    sourceId: id,
    title: 'COS OF YOU',
    artist: 'Morrisson',
    durationSec: 365,
    downloadable: true,
    pageUrl: page,
  });
  const seed = scTrack('2409867324', 'https://soundcloud.com/morrisson-sc/cos-of-you');
  const scOnly = { youtubeEnabled: false, soundcloudEnabled: true };
  /** yt-dlp `--dump-pages`: ответ SoundCloud с рекомендациями к треку. */
  const relatedRun = () =>
    vi.fn(async (_args: readonly string[]) => ({
      stdout: `[soundcloud:related] Dumping request to https://api-v2.soundcloud.com/tracks/2409867324/related?limit=200\n${Buffer.from(JSON.stringify(scRelated)).toString('base64')}`,
      stderr: '',
    }));

  it('волна по треку SoundCloud — его рекомендации на SoundCloud, без YouTube: полные треки, без DRM', async () => {
    const run = relatedRun();
    const fetchJson = fakeFetch({});
    const wave = createWaveService({ run, fetchJson, random: () => 0 });
    const tracks = await wave.start({ title: 'COS OF YOU', lead: [seed], tracks: [seed] }, scOnly);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].at(-1)).toBe('https://soundcloud.com/morrisson-sc/cos-of-you/recommended');
    expect(tracks.map((t) => t.sourceId)).toEqual(RELATED_OPEN_IDS);
    expect(tracks.every((t) => t.source === 'soundcloud')).toBe(true);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('дополнение — рекомендации к недавнему треку SoundCloud при любом раунде (не YouTube Mix и не радио каталога)', async () => {
    const run = relatedRun();
    const fetchJson = fakeFetch({});
    const wave = createWaveService({ run, fetchJson, random: () => 0 });
    const recent = [scTrack('2426052057', 'https://soundcloud.com/user-57160303/s-blake-valhalla-beat-of-the')];
    for (const round of [0, 1, 2]) {
      const tracks = await wave.more({ seed: { title: 'Волна SoundCloud', tracks: [seed] }, recent, round }, scOnly);
      expect(tracks.length).toBeGreaterThan(0);
      expect(tracks.every((t) => t.source === 'soundcloud')).toBe(true);
    }
    const urls = run.mock.calls.map((c) => String(c[0].at(-1)));
    expect(urls.every((u) => u.endsWith('/recommended'))).toBe(true);
    expect(urls).toContain('https://soundcloud.com/user-57160303/s-blake-valhalla-beat-of-the/recommended');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('SoundCloud выключен — понятная ошибка', async () => {
    const wave = createWaveService({ run: vi.fn(), fetchJson: fakeFetch({}) });
    await expect(wave.start({ title: 'x', lead: [seed], tracks: [seed] }, { youtubeEnabled: true, soundcloudEnabled: false })).rejects.toThrow(
      /SoundCloud/,
    );
  });
});
