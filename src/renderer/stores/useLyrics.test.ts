import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lyrics } from '../../shared/lyrics';
import type { Track } from '../../shared/types';
import type { AudioEngineEvents } from '../audioEngine';

// Поддельный <audio>: плееру нужен только приём событий и команды.
const engine = vi.hoisted(() => ({ handlers: {} as Partial<AudioEngineEvents> }));

vi.mock('../audioEngine', () => ({
  audioEngine: {
    on(events: Partial<AudioEngineEvents>) {
      engine.handlers = events;
    },
    load: () => undefined,
    preload: () => undefined,
    cancelPreload: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    stop: () => undefined,
    seek: () => undefined,
    setVolume: () => undefined,
    setMuted: () => undefined,
    currentTime: 0,
  },
}));

const track = (id: string): Track => ({
  id: `archive:${id}`,
  source: 'archive',
  sourceId: `item/${id}.mp3`,
  title: `Песня ${id}`,
  artist: `Исполнитель ${id}`,
  downloadable: true,
});
const tracks = (n: number): Track[] => Array.from({ length: n }, (_, i) => track(`t${i}`));
/** Треки YouTube плеер ждёт без таймера (WAIT_SOURCES): за минуты ожидания повтора он не уйдёт к следующему. */
const waitTracks = (n: number): Track[] =>
  Array.from({ length: n }, (_, i) => ({ ...track(`y${i}`), id: `youtube:y${i}`, source: 'youtube' as const, sourceId: `y${i}` }));
const ids = (list: readonly Track[]) => list.map((t) => t.id);

interface Call {
  track: Track;
  resolve(v: Lyrics): void;
  reject(err: unknown): void;
}

const SYNCED: Lyrics = { kind: 'synced', lines: [{ timeSec: 1, text: 'Раз' }] };
const NONE: Lyrics = { kind: 'none' };

let getCalls: Call[];
let prefetchCalls: string[][];
let player: typeof import('./usePlayer');
let lyrics: typeof import('./useLyrics');

const l = () => lyrics.useLyrics.getState();
const p = () => player.usePlayer.getState();

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  engine.handlers = {};
  getCalls = [];
  prefetchCalls = [];
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    aura: {
      resolveStream: () => new Promise<string>(() => undefined),
      prepareStreams: async () => undefined,
      lyrics: {
        get: (t: Track) =>
          new Promise<Lyrics>((resolve, reject) => {
            getCalls.push({ track: t, resolve, reject });
          }),
        prefetch: async (list: Track[]) => {
          prefetchCalls.push(ids(list));
        },
      },
    },
  });
  player = await import('./usePlayer');
  lyrics = await import('./useLyrics');
  lyrics.initLyrics();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLyrics: текст текущего трека', () => {
  it('до трека — idle; трек запущен — loading, ответ с текстом — ready', async () => {
    expect(l()).toMatchObject({ trackId: null, status: 'idle', lyrics: null, open: false });
    p().playList(tracks(3), 0);
    expect(l()).toMatchObject({ trackId: 'archive:t0', status: 'loading', lyrics: null });
    expect(getCalls.map((c) => c.track.id)).toEqual(['archive:t0']);
    getCalls[0].resolve(SYNCED);
    await vi.advanceTimersByTimeAsync(0);
    expect(l()).toMatchObject({ trackId: 'archive:t0', status: 'ready', lyrics: SYNCED });
  });

  it('«текста нет» — статус none, а не ready', async () => {
    p().playList(tracks(2), 0);
    getCalls[0].resolve(NONE);
    await vi.advanceTimersByTimeAsync(0);
    expect(l()).toMatchObject({ status: 'none', lyrics: NONE });
  });

  it('смена трека: статус нового начинается с loading, текст прошлого не остаётся', async () => {
    p().playList(tracks(3), 0);
    getCalls[0].resolve(SYNCED);
    await vi.advanceTimersByTimeAsync(0);
    p().next();
    expect(l()).toMatchObject({ trackId: 'archive:t1', status: 'loading', lyrics: null });
    getCalls[1].resolve({ kind: 'plain', text: 'Текст второго' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l()).toMatchObject({ trackId: 'archive:t1', status: 'ready', lyrics: { kind: 'plain', text: 'Текст второго' } });
  });

  it('запоздавший ответ про прошлый трек отбрасывается', async () => {
    p().playList(tracks(3), 0);
    p().next();
    getCalls[0].resolve(SYNCED); // ответ про t0, играет уже t1
    await vi.advanceTimersByTimeAsync(0);
    expect(l()).toMatchObject({ trackId: 'archive:t1', status: 'loading', lyrics: null });
  });

  it('ошибка загрузки — error; при следующем показе трека запрос повторяется', async () => {
    p().playList(tracks(3), 0);
    getCalls[0].reject(new Error('нет сети'));
    await vi.advanceTimersByTimeAsync(0);
    expect(l()).toMatchObject({ trackId: 'archive:t0', status: 'error', lyrics: null });
    p().next();
    p().prev();
    expect(getCalls.map((c) => c.track.id)).toEqual(['archive:t0', 'archive:t1', 'archive:t0']);
  });

  it('ошибка — сам повторяет через 5, 15 и 45 с, пока трек тот же; после третьей неудачи — больше не просит', async () => {
    p().playList(waitTracks(3), 0);
    const failLast = async () => {
      getCalls[getCalls.length - 1].reject(new Error('503'));
      await vi.advanceTimersByTimeAsync(0);
    };
    await failLast();
    expect(l().status).toBe('error');
    for (const pause of [5000, 15000, 45000]) {
      const before = getCalls.length;
      await vi.advanceTimersByTimeAsync(pause - 1);
      expect(getCalls, `до ${pause} мс — тихо`).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(getCalls, `через ${pause} мс — повтор`).toHaveLength(before + 1);
      expect(getCalls[before].track.id).toBe('youtube:y0');
      await failLast();
      expect(l()).toMatchObject({ trackId: 'youtube:y0', status: 'error' });
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(getCalls).toHaveLength(4);
  });

  it('повтор принёс текст — кнопка оживает (ready)', async () => {
    p().playList(waitTracks(3), 0);
    getCalls[0].reject(new Error('503'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(getCalls).toHaveLength(2);
    getCalls[1].resolve(SYNCED);
    await vi.advanceTimersByTimeAsync(0);
    expect(l()).toMatchObject({ trackId: 'youtube:y0', status: 'ready', lyrics: SYNCED });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getCalls).toHaveLength(2);
  });

  it('трек сменился, пока ждали повтора, — повтора про прошлый трек нет; у нового — свои повторы', async () => {
    p().playList(waitTracks(3), 0);
    getCalls[0].reject(new Error('503'));
    await vi.advanceTimersByTimeAsync(2000);
    p().next();
    getCalls[1].resolve(SYNCED);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getCalls.map((c) => c.track.id)).toEqual(['youtube:y0', 'youtube:y1']);
    expect(l()).toMatchObject({ trackId: 'youtube:y1', status: 'ready' });
  });

  it('тот же трек остаётся текущим (очередь переложили) — запроса заново нет', async () => {
    const list = tracks(3);
    p().playList(list, 1);
    getCalls[0].resolve(SYNCED);
    await vi.advanceTimersByTimeAsync(0);
    p().playList([...list].reverse(), 1); // t1 снова на позиции 1
    expect(getCalls).toHaveLength(1);
    expect(l().status).toBe('ready');
  });

  it('очередь пуста — idle и слой закрыт', async () => {
    p().playList(tracks(2), 0);
    l().setOpen(true);
    expect(l().open).toBe(true);
    player.usePlayer.setState({ queue: [], index: 0 });
    expect(l()).toMatchObject({ trackId: null, status: 'idle', open: false });
  });
});

describe('useLyrics: заранее', () => {
  it('после паузы 300 мс просит текущий и три следующих; раньше — тихо', async () => {
    p().playList(tracks(8), 2);
    await vi.advanceTimersByTimeAsync(299);
    expect(prefetchCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(prefetchCalls).toEqual([['archive:t2', 'archive:t3', 'archive:t4', 'archive:t5']]);
  });

  it('быстрое листание — один запрос, на самый свежий набор', async () => {
    p().playList(tracks(8), 0);
    await vi.advanceTimersByTimeAsync(100);
    p().next();
    await vi.advanceTimersByTimeAsync(100);
    p().next();
    await vi.advanceTimersByTimeAsync(300);
    expect(prefetchCalls).toEqual([['archive:t2', 'archive:t3', 'archive:t4', 'archive:t5']]);
  });

  it('на конце очереди — сколько есть', async () => {
    p().playList(tracks(5), 3);
    await vi.advanceTimersByTimeAsync(300);
    expect(prefetchCalls).toEqual([['archive:t3', 'archive:t4']]);
  });

  it('тот же набор повторно не просится', async () => {
    p().playList(tracks(8), 0);
    await vi.advanceTimersByTimeAsync(300);
    p().playList(tracks(8), 0);
    await vi.advanceTimersByTimeAsync(300);
    expect(prefetchCalls).toHaveLength(1);
  });

  it('сбой prefetch не ломает показ текста', async () => {
    (window.aura.lyrics as { prefetch: unknown }).prefetch = async () => {
      throw new Error('боль');
    };
    p().playList(tracks(3), 0);
    await vi.advanceTimersByTimeAsync(300);
    getCalls[0].resolve(SYNCED);
    await vi.advanceTimersByTimeAsync(0);
    expect(l().status).toBe('ready');
  });
});
