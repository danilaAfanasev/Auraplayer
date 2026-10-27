import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtistRef } from '../../shared/types';
import deezerRelated21 from './__fixtures__/deezer-related-21savage.json';
import deezerRelatedMadk1d from './__fixtures__/deezer-related-madk1d.json';
import deezerSearch from './__fixtures__/deezer-artist-search.json';
import artistAlbums from './__fixtures__/itunes-artist-albums.json';
import artistAlbumsUs from './__fixtures__/itunes-artist-albums-us.json';
import artistSearch from './__fixtures__/itunes-artist-search.json';
import artistSongs from './__fixtures__/itunes-artist-songs.json';
import artistSongsXxx from './__fixtures__/itunes-artist-songs-xxx.json';
import topSongs from './__fixtures__/itunes-artist-top-songs.json';
import albumsMulti from './__fixtures__/itunes-artists-albums-multi.json';
import appleRss from './__fixtures__/apple-rss-songs.json';
import albumLookup from './__fixtures__/itunes-lookup-album.json';
import { CATALOG_ARTIST_NOT_FOUND } from '../../shared/api';
import {
  createArtistsService,
  isMixOrCompilation,
  parseAlbumLookup,
  parseArtistAlbums,
  parseArtistSongs,
  parseDeezerArtists,
  parseItunesArtists,
  parsePopularArtists,
  pickArtistCards,
  pickDeezerArtist,
  selectReleases,
} from './artists';
import { createCatalogLimiter, createRateLimiter, ITUNES_BASE, type RateLimiter } from './catalog';
import { SourceError } from './types';

/** Без ограничения частоты: тесты сервиса не ждут минутами. */
const NO_LIMIT: RateLimiter = { run: (_priority, fn) => fn() };

const JUICE: ArtistRef = { id: '1368733420', name: 'Juice WRLD' };
const SAVAGE: ArtistRef = { id: '894820464', name: '21 Savage' };
const XXX: ArtistRef = { id: '1082533559', name: 'XXXTENTACION' };

const isSorted = (dates: string[]) => dates.every((d, i) => i === 0 || dates[i - 1] >= d);

describe('поиск артистов в каталоге', () => {
  it('parseItunesArtists: id, имя, жанр', () => {
    const list = parseItunesArtists(artistSearch);
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual({ id: '1368733420', name: 'Juice WRLD', genre: 'Хип-хоп' });
  });

  it('pickArtistCards: только артисты с этим именем, тёзки-дубли и «Juice» на запрос «juice wrld» не попадают', () => {
    const cards = pickArtistCards(parseItunesArtists(artistSearch), 'juice wrld');
    expect(cards.map((c) => [c.id, c.name])).toEqual([['1368733420', 'Juice WRLD']]);
    expect(pickArtistCards(parseItunesArtists(artistSearch), 'Нет такого')).toEqual([]);
  });

  it('pickArtistCards: есть артист ровно с этим именем — однофамильцы «Felipe Saluki» не показываются; нет — показываются', () => {
    const list = [
      { id: '1', name: 'SALUKI' },
      { id: '2', name: 'Felipe Saluki' },
      { id: '3', name: 'Zayan The Saluki' },
    ];
    expect(pickArtistCards(list, 'saluki').map((a) => a.id)).toEqual(['1']);
    expect(pickArtistCards(list.slice(1), 'saluki').map((a) => a.id)).toEqual(['2', '3']);
  });
});

describe('фильтр миксов и сборников', () => {
  it('диджейские миксы «(Mixed)» из lookup песен Juice WRLD и XXXTENTACION отсеиваются', () => {
    const juice = parseArtistSongs(artistSongs, JUICE, 50);
    const xxx = parseArtistSongs(artistSongsXxx, XXX, 50);
    expect(juice.length).toBeGreaterThan(5);
    expect(xxx.length).toBeGreaterThan(3);
    for (const t of [...juice, ...xxx]) {
      expect(t.title).not.toMatch(/mixed/i);
      expect(t.album ?? '').not.toMatch(/DJ Mix/i);
    }
    expect(juice.map((t) => t.title)).toContain('We Don’t Get Along');
    expect(juice.every((t) => t.source === 'catalog' && t.id === `catalog:${t.sourceId}`)).toBe(true);
  });

  it('isMixOrCompilation: миксы, сборники, «Various Artists»; обычный сингл и ремикс самого артиста — нет', () => {
    expect(isMixOrCompilation({ title: 'Lucid Dreams (Mixed)', album: 'Rap Life: May 2026 (DJ Mix)', artist: 'Juice WRLD' })).toBe(true);
    expect(isMixOrCompilation({ title: 'Bad Boy', album: 'Trap Tapes, Vol. 1 (DJ Mix)', artist: 'Juice WRLD' })).toBe(true);
    expect(isMixOrCompilation({ title: 'Hits 2026', artist: 'Various Artists' })).toBe(true);
    expect(isMixOrCompilation({ title: 'Хиты', artist: 'Разные артисты' })).toBe(true);
    expect(isMixOrCompilation({ title: 'We Don’t Get Along', album: 'We Don’t Get Along - Single', artist: 'Juice WRLD & Marshmello' })).toBe(false);
    expect(isMixOrCompilation({ title: 'whoa (mind in awe) [Remix]', artist: 'XXXTENTACION & Juice WRLD' })).toBe(false);
  });
});

describe('релизы артиста', () => {
  it('Juice WRLD: свежий сингл сверху, без дублей explicit/cleaned, без чужих ремиксов, от новых к старым', () => {
    const [group] = parseArtistAlbums(artistAlbums);
    expect(group.artist).toMatchObject({ id: '1368733420', name: 'Juice WRLD', genre: 'Хип-хоп' });
    const releases = selectReleases(group.collections, JUICE);
    expect(releases[0]).toMatchObject({
      title: 'We Don’t Get Along',
      artist: 'Juice WRLD & Marshmello',
      artistId: '1368733420',
      kind: 'single',
      releaseDate: '2026-03-06',
      trackCount: 1,
    });
    expect(releases[0].coverUrl).toMatch(/^https:\/\/.+\/600x600bb\.jpg$/);
    const titles = releases.map((r) => r.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toContain('whoa (mind in awe) [Remix]');
    expect(titles).not.toContain('Suicidal (Remix) [feat. Juice WRLD]');
    expect(isSorted(releases.map((r) => r.releaseDate))).toBe(true);
    expect(releases.find((r) => r.title === 'Fighting Demons')?.kind).toBe('album');
  });

  it('21 Savage (зарубежный каталог): свежие релизы 2026 года сверху', () => {
    const [group] = parseArtistAlbums(artistAlbumsUs);
    const releases = selectReleases(group.collections, SAVAGE);
    expect(releases[0]).toMatchObject({ title: 'WTF GOIN', releaseDate: '2026-06-19', kind: 'single' });
    expect(releases.filter((r) => r.title === 'WHAT HAPPENED TO THE STREETS?')).toHaveLength(1);
  });

  it('lookup нескольких артистов разом: релизы раскладываются по своему артисту', () => {
    const groups = parseArtistAlbums(albumsMulti);
    expect(groups.map((g) => g.artist.name)).toEqual(['madk1d', 'VILLIAN']);
    expect(groups[0].collections).toHaveLength(10);
    expect(groups[1].collections.map((c) => c.title)).toContain('Красивое Зло');
  });
});

describe('популярные треки', () => {
  it('21 Savage: песни с ним по популярности, без «type beat» и инструменталов чужих авторов', () => {
    const tracks = parseArtistSongs(topSongs, SAVAGE, 10);
    expect(tracks).toHaveLength(10);
    expect(tracks.slice(0, 3).map((t) => t.title)).toEqual([
      'rockstar (feat. 21 Savage)',
      '10 Freaky Girls (feat. 21 Savage)',
      'Floating (feat. 21 Savage)',
    ]);
    expect(tracks.every((t) => !/instrumental|type beat/i.test(t.title))).toBe(true);
  });
});

describe('похожие артисты (открытый API)', () => {
  it('parseDeezerArtists: имя, фото, число поклонников', () => {
    const list = parseDeezerArtists(deezerSearch);
    expect(list[0]).toEqual({
      id: '153072532',
      name: 'madk1d',
      fans: 5980,
      imageUrl: 'https://cdn-images.dzcdn.net/images/artist/9d710ff7ef2045519a0b1835966e684c/1000x1000-000000-80-0-0.jpg',
    });
  });

  it('заглушка вместо фото не берётся', () => {
    const [a] = parseDeezerArtists({
      data: [{ id: 1, name: '21 Savage', nb_fan: 0, picture_xl: 'https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg' }],
    });
    expect(a).toEqual({ id: '1', name: '21 Savage', fans: 0 });
  });

  it('pickDeezerArtist: точное имя без учёта регистра, иначе null', () => {
    const list = parseDeezerArtists(deezerSearch);
    expect(pickDeezerArtist(list, 'MADK1D')?.id).toBe('153072532');
    expect(pickDeezerArtist(list, 'Неизвестный')).toBeNull();
  });

  it('похожие на madk1d — русский круг, на 21 Savage — зарубежный', () => {
    expect(parseDeezerArtists(deezerRelatedMadk1d).slice(0, 3).map((a) => a.name)).toEqual(['CUPSIZE', 'тёмный принц', 'FORTUNA 812']);
    expect(parseDeezerArtists(deezerRelated21).slice(0, 3).map((a) => a.name)).toEqual(['Future', 'Metro Boomin', 'Young Thug']);
  });
});

// ---------- сервис: страница артиста и лента ----------

type Route = [RegExp, unknown];

function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  const fetchJson = async (url: string): Promise<unknown> => {
    calls.push(url);
    for (const [re, body] of routes) if (re.test(url)) return typeof body === 'function' ? (body as (u: string) => unknown)(url) : body;
    return { resultCount: 0, results: [], data: [] };
  };
  return { fetchJson, calls };
}

const empty = { resultCount: 0, results: [] };
const memoryCache = () => {
  let data: unknown = null;
  return { readCache: async () => data, writeCache: async (d: unknown) => void (data = d) };
};

const DAY = 86_400_000;

describe('createArtistsService', () => {
  it('страница артиста: имя, фото, популярные треки, релизы, похожие без самого артиста', async () => {
    const { fetchJson } = fakeFetch([
      [/lookup\?id=894820464&entity=album.*country=ru/, empty],
      [/lookup\?id=894820464&entity=album.*country=us/, artistAlbumsUs],
      [/search\?term=21%20Savage&entity=song/, topSongs],
      [/api\.deezer\.com\/search\/artist/, { data: [{ id: 6853403, name: '21 Savage', nb_fan: 1532800, picture_xl: 'https://img.example/21.jpg' }] }],
      [/api\.deezer\.com\/artist\/6853403\/related/, deezerRelated21],
    ]);
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT });
    const page = await service.page({ id: '894820464' });
    expect(page.artist).toMatchObject({ id: '894820464', name: '21 Savage', imageUrl: 'https://img.example/21.jpg' });
    expect(page.topTracks[0].title).toBe('rockstar (feat. 21 Savage)');
    expect(page.releases[0].title).toBe('WTF GOIN');
    expect(page.similar.slice(0, 3).map((a) => a.name)).toEqual(['Future', 'Metro Boomin', 'Young Thug']);
  });

  it('страница по имени (карточка похожего артиста): имя находится в каталоге', async () => {
    const { fetchJson, calls } = fakeFetch([
      [/search\?term=Juice%20WRLD&entity=musicArtist/, artistSearch],
      [/lookup\?id=1368733420&entity=album.*country=ru/, artistAlbums],
    ]);
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT });
    const page = await service.page({ name: 'Juice WRLD' });
    expect(page.artist.id).toBe('1368733420');
    expect(page.releases[0].title).toBe('We Don’t Get Along');
    // Похожие не нашлись — страница всё равно есть, фото — обложка свежего релиза.
    expect(page.similar).toEqual([]);
    expect(page.artist.imageUrl).toMatch(/600x600bb\.jpg$/);
    expect(calls.some((u) => u.includes('country=ru'))).toBe(true);
  });

  it('популярных в поиске мало — добираются свежими песнями артиста из каталога, без повторов', async () => {
    const pick = (title: string) => artistSongs.results.find((r) => 'trackName' in r && r.trackName === title);
    const two = { results: [pick('We Don’t Get Along'), pick('Wake Up!')] };
    const { fetchJson } = fakeFetch([
      [/lookup\?id=1368733420&entity=album.*country=ru/, artistAlbums],
      [/search\?term=Juice%20WRLD&entity=song/, two],
      [/lookup\?id=1368733420&entity=song.*country=ru/, artistSongs],
    ]);
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT });
    const page = await service.page({ id: '1368733420' });
    expect(page.topTracks.length).toBeGreaterThanOrEqual(8);
    expect(page.topTracks.length).toBeLessThanOrEqual(10);
    expect(page.topTracks.slice(0, 2).map((t) => t.title).sort()).toEqual(['Wake Up!', 'We Don’t Get Along']);
    expect(page.topTracks.filter((t) => t.title === 'We Don’t Get Along')).toHaveLength(1);
  });

  it('поиск артиста: пусто в российском каталоге — ищет в зарубежном', async () => {
    const { fetchJson, calls } = fakeFetch([
      [/entity=musicArtist.*country=ru/, empty],
      [/entity=musicArtist.*country=us/, artistSearch],
    ]);
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT });
    const cards = await service.search('Juice WRLD');
    expect(cards.map((c) => c.name)).toEqual(['Juice WRLD']);
    expect(calls.filter((u) => u.includes('musicArtist')).map((u) => /country=(\w+)/.exec(u)?.[1])).toEqual(['ru', 'us']);
  });

  it('страна каталога — из настройки: сначала она, потом США, без дублей', async () => {
    const searchOrder = async (country: 'de' | 'us') => {
      const { fetchJson, calls } = fakeFetch([[/entity=musicArtist/, empty]]);
      const service = createArtistsService({ country: () => country, fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT });
      await service.search('Juice WRLD');
      return calls.filter((u) => u.includes('musicArtist')).map((u) => /country=([a-z]+)/.exec(u)?.[1]);
    };
    expect(await searchOrder('de')).toEqual(['de', 'us']);
    expect(await searchOrder('us')).toEqual(['us']);
  });

  it('нет сети — ошибка «Нет соединения», а не пустая страница', async () => {
    const service = createArtistsService({
      country: () => 'ru',
      fetchJson: async () => {
        throw new SourceError('offline');
      },
      ...memoryCache(),
      sleep: async () => undefined, limiter: NO_LIMIT,
    });
    await expect(service.page({ id: '894820464' })).rejects.toMatchObject({ kind: 'offline' });
  });

  it('лента: свежие релизы подписок (новые сверху) и «Свежее от похожих» с подписью, без подписок самих', async () => {
    const now = Date.parse('2026-08-15T12:00:00Z');
    const { fetchJson, calls } = fakeFetch([
      [/lookup\?id=1598190372,1818347359&entity=album/, albumsMulti],
      [/api\.deezer\.com\/search\/artist\?q=madk1d/, deezerSearch],
      [/api\.deezer\.com\/search\/artist\?q=VILLIAN/, { data: [{ id: 573337, name: 'villian', nb_fan: 331 }] }],
      [/api\.deezer\.com\/artist\/153072532\/related/, deezerRelatedMadk1d],
      [/api\.deezer\.com\/artist\/573337\/related/, { data: [{ id: 153072532, name: 'madk1d' }, { id: 124167622, name: 'CUPSIZE' }] }],
      [/search\?term=CUPSIZE&entity=musicArtist/, { results: [{ wrapperType: 'artist', artistId: 111, artistName: 'CUPSIZE', primaryGenreName: 'Хип-хоп' }] }],
      [/search\?term=.*&entity=musicArtist/, empty],
      [
        /lookup\?id=111&entity=album/,
        {
          results: [
            { wrapperType: 'artist', artistId: 111, artistName: 'CUPSIZE' },
            { wrapperType: 'collection', collectionType: 'Album', collectionId: 901, artistId: 111, artistName: 'CUPSIZE', collectionName: 'Свежак - Single', trackCount: 1, releaseDate: '2026-08-01T07:00:00Z' },
            { wrapperType: 'collection', collectionType: 'Album', collectionId: 902, artistId: 111, artistName: 'CUPSIZE', collectionName: 'Старьё', trackCount: 9, releaseDate: '2010-01-01T07:00:00Z' },
          ],
        },
      ],
    ]);
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT, now: () => now });
    const feed = await service.buildFeed([
      { id: '1598190372', name: 'madk1d', followedAt: 1 },
      { id: '1818347359', name: 'VILLIAN', followedAt: 2 },
    ]);

    expect(feed.followed.map((r) => r.title)).toEqual(['Красивое Зло', 'Общество Мертвых Поэтов', 'летник', 'Мало 2.0 (feat. OG Buda, Toxi$, Мэйби Бэйби, Baby Cute, Дора, madk1d & тёмный принц)']);
    expect(isSorted(feed.followed.map((r) => r.releaseDate))).toBe(true);
    expect(feed.followed.every((r) => Date.parse(r.releaseDate) >= now - 90 * DAY)).toBe(true);

    expect(feed.similar).toEqual([
      expect.objectContaining({ title: 'Свежак', artist: 'CUPSIZE', artistId: '111', similarTo: { id: '1598190372', name: 'madk1d' } }),
    ]);
    // Подписки сами в «похожих» не ищутся.
    expect(calls.some((u) => /search\?term=(madk1d|VILLIAN)&entity=musicArtist/i.test(u))).toBe(false);
  });

  it('лента: у подписки нет релизов за 90 дней — её последние релизы за полгода (до трёх), артист не пропадает', async () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const { fetchJson } = fakeFetch([[/lookup\?id=1598190372,1818347359&entity=album/, albumsMulti]]);
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT, now: () => now });
    const feed = await service.buildFeed([
      { id: '1598190372', name: 'madk1d', followedAt: 1 },
      { id: '1818347359', name: 'VILLIAN', followedAt: 2 },
    ]);
    expect(feed.followed.map((r) => r.title)).toEqual(['Красивое Зло', 'Общество Мертвых Поэтов', 'летник', 'Мало 2.0 (feat. OG Buda, Toxi$, Мэйби Бэйби, Baby Cute, Дора, madk1d & тёмный принц)']);
    expect(feed.followed.every((r) => Date.parse(r.releaseDate) >= now - 180 * DAY)).toBe(true);
  });

  it('лента: не больше 5 похожих на подписку и 40 артистов всего; id похожих в каталоге кэшируются между запусками', async () => {
    const followed = Array.from({ length: 10 }, (_, i) => ({ id: String(500 + i), name: `Подписка ${i}`, followedAt: i }));
    const { fetchJson, calls } = fakeFetch([
      [/api\.deezer\.com\/search\/artist/, (u: string) => ({ data: [{ id: 100 + Number(/%20(\d+)/.exec(u)![1]), name: decodeURIComponent(/q=([^&]+)/.exec(u)![1]) }] })],
      [/api\.deezer\.com\/artist\/\d+\/related/, (u: string) => ({ data: Array.from({ length: 20 }, (_, i) => ({ id: i, name: `Похожий ${/artist\/(\d+)/.exec(u)![1]}-${i}` })) })],
      [/entity=musicArtist/, (u: string) => ({ results: [{ wrapperType: 'artist', artistId: calls.length, artistName: decodeURIComponent(/term=([^&]+)/.exec(u)![1]) }] })],
    ]);
    const cache = memoryCache();
    await createArtistsService({ country: () => 'ru', fetchJson, ...cache, sleep: async () => undefined, limiter: NO_LIMIT }).buildFeed(followed);
    const searched = calls.filter((u) => u.includes('entity=musicArtist')).map((u) => decodeURIComponent(/term=([^&]+)/.exec(u)![1]));
    expect(searched).toHaveLength(40);
    expect(searched.filter((n) => n.startsWith('Похожий 100-'))).toHaveLength(5);

    const before = calls.length;
    await createArtistsService({ country: () => 'ru', fetchJson, ...cache, sleep: async () => undefined, limiter: NO_LIMIT }).buildFeed(followed);
    expect(calls.slice(before).filter((u) => u.includes('entity=musicArtist'))).toEqual([]);
  });
});

describe('популярные артисты (подсказки подписок и первый запуск)', () => {
  it('исполнители чарта: id и имя основного исполнителя (по адресу его страницы), жанры — тегами, без повторов', () => {
    const list = parsePopularArtists(appleRss);
    expect(list.slice(0, 3)).toEqual([
      { id: '1818347359', name: 'VILLIAN', tags: ['hiphop'] },
      { id: '1858260304', name: 'МАЯК X', tags: ['pop'] },
      { id: '1524416796', name: 'By Индия', tags: ['pop'] },
    ]);
    expect(list.find((a) => a.id === '1391094568')?.name).toBe('Koss');
    expect(list.find((a) => a.id === '1890366317')).toEqual({ id: '1890366317', name: 'Imael Angel', tags: ['electronic'] });
    expect(list.find((a) => a.id === '1764325904')?.tags).toEqual(['pop', 'rock']);
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
    const duo = { feed: { results: [{ artistName: 'Artik & Asti', artistId: '9', artistUrl: 'https://music.apple.com/ru/artist/artik-asti/9' }] } };
    expect(parsePopularArtists(duo)).toEqual([{ id: '9', name: 'Artik & Asti' }]);
    expect(parsePopularArtists(null)).toEqual([]);
  });

  it('чарт своей страны, с фото; повторный вызов — из кэша; каталог (лимит частоты) не трогается', async () => {
    const { fetchJson, calls } = fakeFetch([
      [/rss\.marketingtools\.apple\.com\/api\/v2\/de\/music\/most-played\/100\/songs\.json/, appleRss],
      [/api\.deezer\.com\/search\/artist\?q=VILLIAN/, { data: [{ id: 5, name: 'VILLIAN', nb_fan: 10, picture_xl: 'https://img.example/v.jpg' }] }],
    ]);
    const service = createArtistsService({ country: () => 'de', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT });
    const list = await service.popular();
    expect(list[0]).toEqual({ id: '1818347359', name: 'VILLIAN', imageUrl: 'https://img.example/v.jpg', tags: ['hiphop'] });
    expect(list).toHaveLength(10);
    expect(calls.some((u) => u.startsWith(ITUNES_BASE))).toBe(false);
    const before = calls.length;
    expect(await service.popular()).toEqual(list);
    expect(calls.length).toBe(before);
  });

  it('чарт не ответил — ошибка, без пустого кэша', async () => {
    let up = false;
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url.includes('rss.marketingtools') && !up) throw new SourceError('offline');
      return url.includes('rss.marketingtools') ? appleRss : { data: [] };
    };
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT });
    await expect(service.popular()).rejects.toBeInstanceOf(SourceError);
    up = true;
    expect(await service.popular()).toHaveLength(10);
  });
});

describe('ограничитель частоты запросов к каталогу', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('не больше limit запросов за окно; из ждущих первыми идут действия пользователя', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const started: string[] = [];
    const job = (name: string) => async () => {
      started.push(name);
      return name;
    };
    const background = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((n) => limiter.run('background', job(n)));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['b1', 'b2', 'b3']);

    const user = limiter.run('user', job('u1'));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(started).toEqual(['b1', 'b2', 'b3']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toEqual(['b1', 'b2', 'b3', 'u1', 'b4', 'b5']);
    expect(await user).toBe('u1');

    await vi.advanceTimersByTimeAsync(59_000);
    expect(started).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started.at(-1)).toBe('b6');
    expect(await Promise.all(background)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  });

  it('фону — не больше backgroundLimit мест в окне: запрос пользователя при занятом фоном окне стартует сразу', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, backgroundLimit: 3 });
    const started: string[] = [];
    const job = (name: string) => async () => {
      started.push(name);
      return name;
    };
    for (const n of ['b1', 'b2', 'b3', 'b4', 'b5']) void limiter.run('background', job(n));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['b1', 'b2', 'b3']);

    const u1 = limiter.run('user', job('u1'));
    const u2 = limiter.run('user', job('u2'));
    expect(started).toEqual(['b1', 'b2', 'b3', 'u1', 'u2']);
    expect(await Promise.all([u1, u2])).toEqual(['u1', 'u2']);

    // Окно заполнено целиком — следующий пользователь ждёт, но раньше фона.
    void limiter.run('user', job('u3'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started.slice(5)).toEqual(['u3', 'b4', 'b5']);
  });

  it('ошибка запроса достаётся вызывающему, очередь идёт дальше', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10 });
    const failed = limiter.run('user', async () => {
      throw new SourceError('unavailable');
    });
    const next = limiter.run('background', async () => 'дальше');
    await expect(failed).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await next).toBe('дальше');
  });

  it('лента после «Подписаться на всех»: каталог не получает больше 20 запросов в минуту, сборка дособирается, поиск пользователя идёт без очереди', async () => {
    vi.useFakeTimers();
    const followed = Array.from({ length: 10 }, (_, i) => ({ id: String(500 + i), name: `Подписка ${i}`, followedAt: i }));
    const { fetchJson: route, calls } = fakeFetch([
      [/term=Juice%20WRLD&entity=musicArtist/, artistSearch],
      [/api\.deezer\.com\/search\/artist/, (u: string) => ({ data: [{ id: 100 + Number(/%20(\d+)/.exec(u)?.[1] ?? 0), name: decodeURIComponent(/q=([^&]+)/.exec(u)![1]) }] })],
      [/api\.deezer\.com\/artist\/\d+\/related/, (u: string) => ({ data: Array.from({ length: 20 }, (_, i) => ({ id: i, name: `Похожий ${/artist\/(\d+)/.exec(u)![1]}-${i}` })) })],
      [/entity=musicArtist/, (u: string) => ({ results: [{ wrapperType: 'artist', artistId: 9000 + calls.length, artistName: decodeURIComponent(/term=([^&]+)/.exec(u)![1]) }] })],
    ]);
    // Каталог, как настоящий: больше 20 запросов за минуту — отказ.
    const catalogAt: number[] = [];
    let refused = 0;
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url.startsWith(ITUNES_BASE)) {
        const t = Date.now();
        if (catalogAt.filter((x) => t - x < 60_000).length >= 20) {
          refused++;
          throw new SourceError('unavailable');
        }
        catalogAt.push(t);
      }
      return route(url);
    };
    const service = createArtistsService({ country: () => 'ru', fetchJson, ...memoryCache(), limiter: createCatalogLimiter() });

    let done = false;
    const feed = service.buildFeed(followed).finally(() => (done = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(catalogAt).toHaveLength(15); // фон занял свои 15 мест в окне и ждёт
    let answered = false;
    const cards = service.search('Juice WRLD').finally(() => (answered = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBe(true); // поиск пользователя не ждал окна
    expect((await cards).map((c) => c.name)).toEqual(['Juice WRLD']);
    expect(done).toBe(false); // лента ещё собирается

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await feed;
    expect(refused).toBe(0);
    const catalog = calls.filter((u) => u.startsWith(ITUNES_BASE));
    // Поиск пользователя ушёл сразу за 15 фоновыми, не дожидаясь следующей минуты.
    expect(catalog.findIndex((u) => u.includes('term=Juice%20WRLD'))).toBe(15);
    const searched = catalog.filter((u) => u.includes('entity=musicArtist') && !u.includes('Juice'));
    expect(searched).toHaveLength(40);
  });
});

// ---------- таск 18: альбом, точное имя ----------

describe('страница альбома и переход по имени', () => {
  const service = (routes: Route[]) => {
    const fake = fakeFetch(routes);
    return {
      ...fake,
      service: createArtistsService({ country: () => 'ru', fetchJson: fake.fetchJson, ...memoryCache(), sleep: async () => undefined, limiter: NO_LIMIT }),
    };
  };

  it('разбор lookup альбома: метаданные из обёртки коллекции, треки по порядку, общая длительность', () => {
    const page = parseAlbumLookup(albumLookup, '6820766679');
    expect(page).not.toBeNull();
    expect(page!.release).toMatchObject({
      id: '6820766679',
      title: 'Omertà 2',
      artist: 'Captown, Niman, Truwer & Экси',
      artistId: '1436282869',
      kind: 'album',
      releaseDate: '2026-10-23',
      trackCount: 10,
    });
    expect(page!.release.coverUrl).toMatch(/600x600bb\.jpg$/);
    expect(page!.tracks.map((t) => t.title).slice(0, 3)).toEqual(['WORK', 'РАЗБОГАТЕТЬ ИЛИ СДОХНУТЬ', 'БАЗАРУ НЕТ']);
    expect(page!.tracks).toHaveLength(10);
    expect(page!.tracks.every((t) => t.id.startsWith('catalog:'))).toBe(true);
    // 206118+239194+186809+165000+177391+189873+213333+208696+161928+270000 мс, каждая округлена до секунды
    expect(page!.durationSec).toBe(206 + 239 + 187 + 165 + 177 + 190 + 213 + 209 + 162 + 270);
  });

  it('разбор lookup альбома: « - EP» в названии — EP без суффикса; треки в обратном порядке — сортируются по номеру', () => {
    const json = {
      results: [
        { wrapperType: 'collection', collectionType: 'Album', collectionId: 5, artistId: 7, artistName: 'A & B', collectionName: 'Тихо - EP', trackCount: 2, releaseDate: '2025-03-01T07:00:00Z' },
        { wrapperType: 'track', kind: 'song', trackId: 52, collectionId: 5, trackName: 'Два', artistName: 'A & B', trackNumber: 2, discNumber: 1, trackTimeMillis: 60_000 },
        { wrapperType: 'track', kind: 'song', trackId: 51, collectionId: 5, trackName: 'Один', artistName: 'A & B', trackNumber: 1, discNumber: 1, trackTimeMillis: 30_000 },
      ],
    };
    const page = parseAlbumLookup(json, '5')!;
    expect(page.release).toMatchObject({ title: 'Тихо', kind: 'ep', artist: 'A & B' });
    expect(page.tracks.map((t) => t.title)).toEqual(['Один', 'Два']);
    expect(page.durationSec).toBe(90);
  });

  it('альбом через сервис: запрос к каталогу через ограничитель; нет в российском — ищет в зарубежном', async () => {
    const ran: string[] = [];
    const fake = fakeFetch([
      [/lookup\?id=6820766679&entity=song.*country=ru/, empty],
      [/lookup\?id=6820766679&entity=song.*country=us/, albumLookup],
    ]);
    const limiter: RateLimiter = { run: (priority, fn) => (ran.push(priority), fn()) };
    const s = createArtistsService({ country: () => 'ru', fetchJson: fake.fetchJson, ...memoryCache(), sleep: async () => undefined, limiter });
    const page = await s.album('6820766679');
    expect(page.release.title).toBe('Omertà 2');
    expect(ran).toEqual(['user', 'user']);
    await expect(s.album('мусор')).rejects.toBeInstanceOf(SourceError);
  });

  it('ник без точного совпадения в каталоге — «не найден», а не тёзка с похожим именем', async () => {
    const { service: s, calls } = service([
      [
        /search\?term=sqwore&entity=musicArtist/,
        {
          results: [
            { wrapperType: 'artist', artistId: 1, artistName: 'Sqwore Beats' },
            { wrapperType: 'artist', artistId: 2, artistName: 'sqwore x lil' },
          ],
        },
      ],
    ]);
    await expect(s.page({ name: 'sqwore' })).rejects.toMatchObject({ kind: 'unavailable', message: CATALOG_ARTIST_NOT_FOUND });
    expect(calls.some((u) => u.includes('entity=album'))).toBe(false);
  });

  it('точное совпадение (регистр и знаки не важны) — страница этого артиста', async () => {
    const { service: s } = service([
      [/search\?term=JUICE%20wrld&entity=musicArtist/, artistSearch],
      [/lookup\?id=1368733420&entity=album.*country=ru/, artistAlbums],
    ]);
    expect((await s.page({ name: 'JUICE wrld' })).artist.id).toBe('1368733420');
  });
});
