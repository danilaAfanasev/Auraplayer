import { describe, expect, it, vi } from 'vitest';
import type { Lyrics } from '../shared/lyrics';
import type { Track } from '../shared/types';
import getSynced from './sources/__fixtures__/lrclib-get-synced.json';
import candidates from './sources/__fixtures__/lrclib-search-candidates.json';
import busy from './sources/__fixtures__/lrclib-error-busy.json';
import instrumental from './sources/__fixtures__/lrclib-search-instrumental.json';
import { createLyricsService, NONE_RECHECK_MS, type LyricsDeps, type LyricsFetch } from './lyrics';
import { SourceError } from './sources/types';

const track = (over: Partial<Track> = {}): Track => ({
  id: 'youtube:abc',
  source: 'youtube',
  sourceId: 'abc',
  title: 'Вредные привычки',
  artist: 'madk1d',
  durationSec: 142,
  downloadable: true,
  ...over,
});

const stronger = (over: Partial<Track> = {}): Track =>
  track({ id: 'catalog:1', source: 'catalog', sourceId: '1', title: 'Stronger', artist: 'Kanye West', durationSec: 312, ...over });

const ok = (json: unknown) => ({ status: 200, json });
/** Базе нечего ответить: /get — 404, поиск — пустой список. */
const nothing = (u: URL) => (u.pathname === '/api/get' ? { status: 404, json: null } : ok([]));
const notFound = { status: 404, json: { statusCode: 404, name: 'TrackNotFound' } };

function setup(handler: (url: URL) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }>, over: Partial<LyricsDeps> = {}) {
  const urls: URL[] = [];
  const fetch: LyricsFetch = vi.fn(async (url: string) => {
    const u = new URL(url);
    urls.push(u);
    return handler(u);
  });
  let stored: unknown = {};
  let now = 1_000_000;
  const writes: unknown[] = [];
  const deps: LyricsDeps = {
    fetch,
    readCache: async () => stored,
    writeCache: async (data) => {
      stored = JSON.parse(JSON.stringify(data));
      writes.push(stored);
    },
    now: () => now,
    retryDelayMs: 0,
    ...over,
  };
  return {
    svc: createLyricsService(deps),
    fetch,
    urls,
    writes,
    advance: (ms: number) => {
      now += ms;
    },
    stored: () => stored,
  };
}

/** Ответ, который отдаётся вручную: для проверки очереди и числа запросов разом. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

describe('createLyricsService.get', () => {
  it('точный запрос /get: исполнитель, название, альбом и длительность в адресе; синхронный текст', async () => {
    const t = setup(() => ok(getSynced));
    const lyrics = await t.svc.get(track({ album: 'Вредные привычки' }));
    expect(lyrics.kind).toBe('synced');
    expect(t.urls).toHaveLength(1);
    expect(t.urls[0].pathname).toBe('/api/get');
    expect(t.urls[0].searchParams.get('artist_name')).toBe('madk1d');
    expect(t.urls[0].searchParams.get('track_name')).toBe('Вредные привычки');
    expect(t.urls[0].searchParams.get('album_name')).toBe('Вредные привычки');
    expect(t.urls[0].searchParams.get('duration')).toBe('142');
  });

  it('повтор трека — из кэша без сети, и для той же песни из другого источника', async () => {
    const t = setup(() => ok(getSynced));
    await t.svc.get(track());
    const again = await t.svc.get(track({ id: 'soundcloud:9', source: 'soundcloud', sourceId: '9', title: 'Вредные привычки (Official Video)' }));
    expect(again.kind).toBe('synced');
    expect(t.urls).toHaveLength(1);
  });

  it('кэш переживает перезапуск: новый сервис читает сохранённый файл', async () => {
    const t = setup(() => ok(getSynced));
    await t.svc.get(track());
    const second = createLyricsService({ fetch: vi.fn(), readCache: async () => t.stored(), writeCache: async () => undefined });
    expect((await second.get(track())).kind).toBe('synced');
  });

  it('/get ответил 404 — поиск, из списка берётся синхронный подходящий по длительности', async () => {
    const t = setup((u) => (u.pathname === '/api/get' ? notFound : ok(candidates)));
    const lyrics = await t.svc.get(stronger());
    expect(lyrics.kind).toBe('synced');
    expect(t.urls.map((u) => u.pathname)).toEqual(['/api/get', '/api/search']);
    expect(t.urls[1].searchParams.get('artist_name')).toBe('Kanye West');
    expect(t.urls[1].searchParams.get('track_name')).toBe('Stronger');
  });

  it('/get вернул другую песню — не берём, ищем', async () => {
    const wrong = { ...(candidates[3] as object) };
    const t = setup((u) => (u.pathname === '/api/get' ? ok(wrong) : ok(candidates)));
    const lyrics = await t.svc.get(stronger());
    expect(lyrics.kind).toBe('synced');
    expect(t.urls).toHaveLength(2);
  });

  it('ничего подходящего — «нет», и это кэшируется', async () => {
    const t = setup((u) => (u.pathname === '/api/get' ? notFound : ok([])));
    expect(await t.svc.get(track())).toEqual({ kind: 'none' });
    expect(await t.svc.get(track())).toEqual({ kind: 'none' });
    expect(t.urls).toHaveLength(2); // get + search только в первый раз
  });

  it('инструментал — «текста нет»; «нет» перепроверяется через сутки', async () => {
    const t = setup((u) => (u.pathname === '/api/get' ? notFound : ok(instrumental)));
    const kai = track({ title: 'GOD SYSTEM', artist: 'Kai Angel', durationSec: 131 });
    expect(await t.svc.get(kai)).toEqual({ kind: 'none' });
    t.advance(NONE_RECHECK_MS - 1000);
    await t.svc.get(kai);
    expect(t.urls).toHaveLength(2);
    t.advance(2000);
    await t.svc.get(kai);
    expect(t.urls).toHaveLength(4);
  });

  it('нашлось после «нет»: перепроверка заменяет запись текстом', async () => {
    let found = false;
    const t = setup((u) => (u.pathname === '/api/get' ? (found ? ok(getSynced) : notFound) : ok([])));
    expect(await t.svc.get(track())).toEqual({ kind: 'none' });
    found = true;
    t.advance(NONE_RECHECK_MS + 1);
    expect((await t.svc.get(track())).kind).toBe('synced');
    t.advance(NONE_RECHECK_MS * 10);
    expect((await t.svc.get(track())).kind).toBe('synced'); // текст не устаревает
    expect(t.urls).toHaveLength(3);
  });

  it('ошибка сети — исключение и не кэшируется; следующий показ трека ищет снова', async () => {
    let down = true;
    const t = setup(() => {
      if (down) throw new SourceError('offline');
      return ok(getSynced);
    });
    await expect(t.svc.get(track())).rejects.toBeInstanceOf(SourceError);
    expect(t.writes).toHaveLength(0);
    down = false;
    expect((await t.svc.get(track())).kind).toBe('synced');
  });

  it('на точный запрос база отвечает «занят» (503) — это не отказ: ищем поиском', async () => {
    const t = setup((u) => (u.pathname === '/api/get' ? { status: 503, json: busy } : ok(candidates)));
    expect((await t.svc.get(stronger())).kind).toBe('synced');
    expect(t.urls.map((u) => u.pathname)).toEqual(['/api/get', '/api/search']); // точный — без повтора
  });

  it('поиск ответил «занят» — одна повторная попытка', async () => {
    let searches = 0;
    const t = setup((u) => {
      if (u.pathname === '/api/get') return notFound;
      return ++searches === 1 ? { status: 503, json: busy } : ok(candidates);
    });
    expect((await t.svc.get(stronger())).kind).toBe('synced');
    expect(searches).toBe(2);
  });

  it('и точный запрос, и поиск заняты — ошибка, в кэш не пишется', async () => {
    const dead = setup(() => ({ status: 503, json: busy }));
    await expect(dead.svc.get(track())).rejects.toBeInstanceOf(SourceError);
    expect(dead.writes).toHaveLength(0);
  });

  it('нет сети на точном запросе — сразу ошибка, поиск не пробуем', async () => {
    const t = setup(() => {
      throw new SourceError('offline');
    });
    await expect(t.svc.get(track())).rejects.toMatchObject({ kind: 'offline' });
    expect(t.urls).toHaveLength(1);
  });

  it('просроченное «нет» при недоступной сети остаётся «нет», запись не теряется', async () => {
    let down = false;
    const t = setup((u) => {
      if (down) throw new SourceError('offline');
      return u.pathname === '/api/get' ? notFound : ok([]);
    });
    await t.svc.get(track());
    t.advance(NONE_RECHECK_MS + 1);
    down = true;
    expect(await t.svc.get(track())).toEqual({ kind: 'none' });
  });

  it('нет исполнителя или названия — «нет» без запросов', async () => {
    const t = setup(() => ok(getSynced));
    expect(await t.svc.get(track({ artist: '  ' }))).toEqual({ kind: 'none' });
    expect(t.urls).toHaveLength(0);
  });

  it('два одновременных запроса одного трека — одна загрузка', async () => {
    const g = gate();
    const t = setup(async () => {
      await g.opened;
      return ok(getSynced);
    });
    const a = t.svc.get(track());
    const b = t.svc.get(track());
    g.open();
    expect((await Promise.all([a, b])).map((l) => l.kind)).toEqual(['synced', 'synced']);
    expect(t.urls).toHaveLength(1);
  });

  it('битые записи кэша отбрасываются, целые остаются', async () => {
    const good: Lyrics = { kind: 'plain', text: 'Строка' };
    const t = setup(() => ok(getSynced), {
      readCache: async () => ({
        'madk1d|вредные привычки|28': { at: 1_000_000, lyrics: good },
        'x|y|1': { at: 'вчера', lyrics: good },
        'x|z|1': { at: 1, lyrics: { kind: 'synced', lines: 'нет' } },
        'x|w|1': 'мусор',
      }),
    });
    expect(await t.svc.get(track())).toEqual(good);
    expect(t.urls).toHaveLength(0);
    await t.svc.get(track({ title: 'Другая', artist: 'Кто-то' }));
    const saved = Object.keys(t.stored() as object);
    expect(saved).toContain('madk1d|вредные привычки|28');
    expect(saved).not.toContain('x|z|1');
  });
});

describe('createLyricsService: очередь запросов', () => {
  const songs = (n: number): Track[] => Array.from({ length: n }, (_, i) => track({ id: `youtube:${i}`, sourceId: `${i}`, title: `Песня ${i}`, artist: `Артист ${i}` }));

  it('не больше 2 запросов разом', async () => {
    const g = gate();
    let running = 0;
    let peak = 0;
    const t = setup(async (u) => {
      running++;
      peak = Math.max(peak, running);
      await g.opened;
      running--;
      return nothing(u);
    });
    const all = songs(5).map((s) => t.svc.get(s));
    await vi.waitFor(() => expect(running).toBe(2));
    g.open();
    await Promise.all(all);
    expect(peak).toBe(2);
  });

  it('текущий трек обгоняет очередь заранее загружаемых', async () => {
    const g = gate();
    const order: string[] = [];
    const t = setup(async (u) => {
      order.push(u.searchParams.get('artist_name') ?? '');
      await g.opened;
      return nothing(u);
    });
    t.svc.prefetch(songs(4));
    await vi.waitFor(() => expect(order).toHaveLength(2)); // заняты оба места
    const current = t.svc.get(track({ id: 'youtube:cur', sourceId: 'cur', title: 'Текущая', artist: 'Сейчас' }));
    g.open();
    await current;
    expect(order.indexOf('Сейчас')).toBe(2);
  });

  it('новый prefetch отменяет ещё не начатые запросы старого', async () => {
    const g = gate();
    const asked: string[] = [];
    const t = setup(async (u) => {
      asked.push(u.searchParams.get('artist_name') ?? '');
      await g.opened;
      return nothing(u);
    });
    t.svc.prefetch(songs(5));
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    t.svc.prefetch([track({ id: 'youtube:new', sourceId: 'new', title: 'Новая', artist: 'Новый' })]);
    g.open();
    await vi.waitFor(() => expect(asked).toContain('Новый'));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).not.toContain('Артист 2');
    expect(asked).not.toContain('Артист 3');
    expect(asked).not.toContain('Артист 4');
  });

  it('prefetch не бросает при ошибке сети и кладёт найденное в кэш', async () => {
    const t = setup((u) => {
      if (u.searchParams.get('artist_name') === 'Артист 0') throw new SourceError('offline');
      return ok(getSynced);
    });
    t.svc.prefetch([track({ title: 'Песня 0', artist: 'Артист 0' }), track()]);
    await vi.waitFor(() => expect(t.writes.length).toBeGreaterThan(0));
    const before = t.urls.length;
    expect((await t.svc.get(track())).kind).toBe('synced');
    expect(t.urls).toHaveLength(before);
  });
});
