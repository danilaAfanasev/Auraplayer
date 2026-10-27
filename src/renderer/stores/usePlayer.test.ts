import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngineEvents } from '../audioEngine';
import type { Settings, Track } from '../../shared/types';

// Поддельный <audio>: записывает команды плеера и даёт тесту посылать события элемента.
const engine = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    handlers: {} as Partial<AudioEngineEvents>,
    currentTime: 0,
  };
  return state;
});

vi.mock('../audioEngine', () => ({
  audioEngine: {
    on(events: Partial<AudioEngineEvents>) {
      engine.handlers = events;
    },
    load(url: string) {
      engine.calls.push(`load:${url}`);
    },
    preload(url: string) {
      engine.calls.push(`preload:${url}`);
    },
    cancelPreload: () => undefined,
    play: () => engine.calls.push('play'),
    pause: () => engine.calls.push('pause'),
    stop: () => engine.calls.push('stop'),
    seek: (sec: number) => engine.calls.push(`seek:${sec}`),
    setVolume: () => undefined,
    setMuted: () => undefined,
    get currentTime() {
      return engine.currentTime;
    },
  },
}));

const track = (id: string): Track => ({
  id: `archive:${id}`,
  source: 'archive',
  sourceId: `item/${id}.mp3`,
  title: `Песня ${id}`,
  artist: 'Исполнитель',
  downloadable: true,
});

/** Трек, звук которого ищет yt-dlp (YouTube, Каталог, SoundCloud). */
const ytTrack = (id: string, source: 'youtube' | 'catalog' | 'soundcloud' = 'youtube'): Track => ({
  id: `${source}:${id}`,
  source,
  sourceId: id,
  title: `Видео ${id}`,
  artist: 'Канал',
  downloadable: true,
});

interface Deferred {
  resolve(url: string): void;
  reject(err: unknown): void;
}

let streams: Map<string, Deferred>;
let resolveCalls: string[];
/** Второй аргумент resolveStream по вызовам (`{ fresh: true }` — повтор без кэша ссылки). */
let resolveOpts: unknown[];
let savedSettings: Settings[];
/** Что плеер просил main готовить заранее. */
let prepareCalls: { owner: string; ids: string[] }[];
let beforeClose: (() => Promise<void>) | null;
let player: typeof import('./usePlayer');
let ui: typeof import('./useUi');

const tick = () => new Promise((r) => setTimeout(r, 0));

function setupWindow(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal('document', { documentElement: { style: { setProperty: () => undefined }, dataset: {} } });
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    aura: {
      resolveStream: (t: Track, opts?: unknown) =>
        new Promise<string>((resolve, reject) => {
          resolveCalls.push(t.id);
          resolveOpts.push(opts);
          streams.set(t.id, { resolve, reject });
        }),
      prepareStreams: async (owner: string, tracks: Track[]) => {
        prepareCalls.push({ owner, ids: tracks.map((t) => t.id) });
      },
      settings: {
        load: async () => (await import('../../shared/settings')).defaultSettings('C:\\Музыка\\Aura'),
        save: async (s: Settings) => void savedSettings.push(s),
      },
      library: { load: async () => (await import('../../shared/library')).emptyLibrary(), save: async () => undefined },
      onMediaKey: () => () => undefined,
      onBeforeClose: (cb: () => Promise<void>) => {
        beforeClose = cb;
        return () => undefined;
      },
    },
  });
}

/** Очередь A, B, C; A загружен и играет. */
async function playingA(): Promise<void> {
  player.usePlayer.getState().playList([track('a'), track('b'), track('c')], 0);
  streams.get('archive:a')!.resolve('url-a');
  await tick();
  engine.handlers.playing?.();
}

beforeEach(async () => {
  vi.resetModules();
  engine.calls = [];
  engine.handlers = {};
  engine.currentTime = 0;
  streams = new Map();
  resolveCalls = [];
  resolveOpts = [];
  savedSettings = [];
  prepareCalls = [];
  beforeClose = null;
  setupWindow();
  player = await import('./usePlayer');
  ui = await import('./useUi');
  const { useSettings } = await import('./useSettings');
  await useSettings.getState().load();
});

describe('usePlayer: смена трека, пока новый ещё ищется', () => {
  it('прошлый звук замолкает сразу, до ответа resolveStream', async () => {
    await playingA();
    expect(engine.calls).toEqual(['load:url-a']);
    player.usePlayer.getState().playAt(1);
    expect(streams.has('archive:b')).toBe(true); // B ещё не найден
    expect(engine.calls.slice(1)).toContain('stop');
  });

  it('ended от прошлого трека не перескакивает через новый', async () => {
    await playingA();
    player.usePlayer.getState().playAt(1);
    engine.handlers.ended?.();
    await tick();
    expect(player.usePlayer.getState().index).toBe(1);
    expect(resolveCalls).toEqual(['archive:a', 'archive:b']);
  });

  it('error от прошлого трека не отменяет загрузку нового и не пишет «недоступен»', async () => {
    await playingA();
    player.usePlayer.getState().playAt(1);
    engine.handlers.error?.();
    await tick();
    expect(ui.useUi.getState().toasts).toEqual([]);
    expect(player.usePlayer.getState().isLoading).toBe(true);
    streams.get('archive:b')!.resolve('url-b');
    await tick();
    expect(engine.calls.at(-1)).toBe('load:url-b');
    expect(player.usePlayer.getState().index).toBe(1);
  });

  it('playing от прошлого трека не снимает индикатор загрузки нового', async () => {
    await playingA();
    player.usePlayer.getState().playAt(1);
    engine.handlers.playing?.();
    const s = player.usePlayer.getState();
    expect(s.isLoading).toBe(true);
    expect(s.isPlaying).toBe(false);
  });

  it('события нового трека после его загрузки работают как обычно', async () => {
    await playingA();
    player.usePlayer.getState().playAt(1);
    streams.get('archive:b')!.resolve('url-b');
    await tick();
    engine.handlers.playing?.();
    expect(player.usePlayer.getState()).toMatchObject({ isPlaying: true, isLoading: false, index: 1 });
    engine.handlers.ended?.();
    expect(player.usePlayer.getState().index).toBe(2);
  });
});

describe('usePlayer: позиция при закрытии окна', () => {
  it('lastSession с текущей позицией сохраняется в обработчике закрытия', async () => {
    player.initPlayer();
    await playingA();
    engine.currentTime = 3.4;
    engine.handlers.time?.(3.4);
    expect(beforeClose).not.toBeNull();
    await beforeClose!();
    const last = savedSettings.at(-1);
    expect(last?.lastSession?.queue).toEqual(['archive:a', 'archive:b', 'archive:c']);
    expect(Math.abs((last?.lastSession?.positionSec ?? -10) - 3.4)).toBeLessThanOrEqual(1);
  });
});

describe('usePlayer: звук через yt-dlp (YouTube, Каталог, SoundCloud) — ждём, а не листаем', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = () => vi.advanceTimersByTimeAsync(0);

  it.each(['youtube', 'catalog', 'soundcloud'] as const)('%s: звук ищется минуту — плеер ждёт и потом играет этот трек', async (source) => {
    vi.useFakeTimers();
    player.usePlayer.getState().playList([ytTrack('a', source), ytTrack('b', source)], 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(player.usePlayer.getState()).toMatchObject({ index: 0, isLoading: true });
    expect(resolveCalls).toEqual([`${source}:a`]);
    expect(ui.useUi.getState().toasts).toEqual([]);

    streams.get(`${source}:a`)!.resolve('url-a');
    await flush();
    expect(engine.calls.at(-1)).toBe('load:url-a');
    // <audio> тоже может долго буферизовать — таймера нет.
    await vi.advanceTimersByTimeAsync(60_000);
    engine.handlers.playing?.();
    expect(player.usePlayer.getState()).toMatchObject({ index: 0, isPlaying: true, isLoading: false });
  });

  it('другие источники — как раньше: не заиграл за 15 с — следующий', async () => {
    vi.useFakeTimers();
    player.usePlayer.getState().playList([track('a'), track('b')], 0);
    await vi.advanceTimersByTimeAsync(player.LOAD_TIMEOUT_MS + 10);
    expect(player.usePlayer.getState().index).toBe(1);
    expect(resolveCalls).toEqual(['archive:a', 'archive:b']);
  });

  it('звук не нашёлся — одна повторная попытка (без кэша ссылки), затем тост «Повторить», очередь стоит', async () => {
    vi.useFakeTimers();
    player.usePlayer.getState().playList([ytTrack('a'), ytTrack('b')], 0);
    streams.get('youtube:a')!.reject(new Error('YouTube не отвечает'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolveCalls).toEqual(['youtube:a', 'youtube:a']);
    expect(resolveOpts[1]).toEqual({ fresh: true });
    expect(ui.useUi.getState().toasts).toEqual([]);
    expect(player.usePlayer.getState().isLoading).toBe(true);

    streams.get('youtube:a')!.reject(new Error('YouTube не отвечает'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolveCalls).toEqual(['youtube:a', 'youtube:a']);
    expect(player.usePlayer.getState()).toMatchObject({ index: 0, isLoading: false, isPlaying: false });
    const toasts = ui.useUi.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].text).toContain('Не удалось загрузить трек');
    expect(toasts[0].action?.label).toBe('Повторить');

    // «Повторить» — снова этот трек, и он играет.
    toasts[0].action!.run();
    expect(resolveCalls).toEqual(['youtube:a', 'youtube:a', 'youtube:a']);
    expect(player.usePlayer.getState()).toMatchObject({ index: 0, isLoading: true });
    streams.get('youtube:a')!.resolve('url-a');
    await flush();
    engine.handlers.playing?.();
    expect(player.usePlayer.getState()).toMatchObject({ index: 0, isPlaying: true });
  });

  it('ошибка <audio> — повторная попытка тем же треком, а не переход к следующему', async () => {
    vi.useFakeTimers();
    player.usePlayer.getState().playList([ytTrack('a'), ytTrack('b')], 0);
    streams.get('youtube:a')!.resolve('url-a');
    await flush();
    engine.handlers.error?.();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolveCalls).toEqual(['youtube:a', 'youtube:a']);
    streams.get('youtube:a')!.resolve('url-a2');
    await flush();
    expect(engine.calls.at(-1)).toBe('load:url-a2');
    engine.handlers.playing?.();
    expect(player.usePlayer.getState()).toMatchObject({ index: 0, isPlaying: true });
    expect(ui.useUi.getState().toasts).toEqual([]);
  });

  it('ошибка прошлого трека не съедает повторную попытку нового', async () => {
    vi.useFakeTimers();
    player.usePlayer.getState().playList([ytTrack('a'), ytTrack('b')], 0);
    streams.get('youtube:a')!.resolve('url-a');
    await flush();
    engine.handlers.playing?.();
    player.usePlayer.getState().playAt(1);
    engine.handlers.error?.(); // от прошлого трека
    streams.get('youtube:b')!.reject(new Error('сбой'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolveCalls).toEqual(['youtube:a', 'youtube:b', 'youtube:b']);
    expect(ui.useUi.getState().toasts).toEqual([]);
  });
});

describe('usePlayer: трек убранного источника (Jamendo) без скачанного файла', () => {
  it('понятная ошибка, плеер стоит на этом треке и не перескакивает', async () => {
    const retired: Track = { ...track('j'), id: 'jamendo:123', source: 'local', sourceId: '123', downloadable: false };
    player.usePlayer.getState().playList([retired, track('b')], 0);
    streams.get('jamendo:123')!.reject(new Error('Этот источник больше не поддерживается — трек играет, только если он скачан'));
    await tick();
    expect(player.usePlayer.getState()).toMatchObject({ index: 0, isLoading: false, isPlaying: false });
    expect(resolveCalls).toEqual(['jamendo:123']);
    const toasts = ui.useUi.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].text).toBe('Этот источник больше не поддерживается — трек играет, только если он скачан');
  });
});

describe('usePlayer: очередь волны дополняется на ходу', () => {
  it('appendTracks дописывает треки в конец, не трогая играющий', async () => {
    await playingA();
    player.usePlayer.getState().appendTracks([track('d'), track('e')]);
    const s = player.usePlayer.getState();
    expect(s.queue.map((t) => t.id)).toEqual(['archive:a', 'archive:b', 'archive:c', 'archive:d', 'archive:e']);
    expect(s).toMatchObject({ index: 0, isPlaying: true });
    // Играющий не перезапускался (второй запрос — подготовка следующего трека).
    expect(resolveCalls.filter((id) => id === 'archive:a')).toHaveLength(1);
    expect(engine.calls.filter((c) => c.startsWith('load:'))).toEqual(['load:url-a']);
  });

  it('с перемешиванием новые треки тоже попадают в порядок проигрывания', async () => {
    await playingA();
    player.usePlayer.getState().toggleShuffle();
    player.usePlayer.getState().appendTracks([track('d')]);
    const s = player.usePlayer.getState();
    expect([...s.order].sort()).toEqual([0, 1, 2, 3]);
    expect(s.order[0]).toBe(0);
  });

  it('removeUpcoming убирает только ещё не сыгранные треки, играющий остаётся', async () => {
    player.usePlayer.getState().playList([track('a'), track('b'), track('c'), track('d')], 1);
    streams.get('archive:b')!.resolve('url-b');
    await tick();
    engine.handlers.playing?.();
    player.usePlayer.getState().removeUpcoming((t) => t.id === 'archive:a' || t.id === 'archive:b' || t.id === 'archive:c');
    const s = player.usePlayer.getState();
    expect(s.queue.map((t) => t.id)).toEqual(['archive:a', 'archive:b', 'archive:d']);
    expect(s).toMatchObject({ index: 1, isPlaying: true });
  });

  it('очередь кончилась, а волна ещё подбирает треки — плеер ждёт и продолжает с дописанного', async () => {
    const hook = vi.fn(() => true);
    player.setQueueEndHook(hook);
    await playingA();
    player.usePlayer.getState().playAt(2);
    streams.get('archive:c')!.resolve('url-c');
    await tick();
    engine.handlers.playing?.();
    engine.handlers.ended?.();
    expect(hook).toHaveBeenCalled();
    expect(player.usePlayer.getState()).toMatchObject({ index: 2, isLoading: true, isPlaying: false });

    player.usePlayer.getState().appendTracks([track('d')]);
    expect(player.usePlayer.getState().index).toBe(3);
    expect(resolveCalls.at(-1)).toBe('archive:d');
  });

  /** Очередь A, B, C; играет последний — C. */
  async function playingLast(): Promise<void> {
    await playingA();
    player.usePlayer.getState().playAt(2);
    streams.get('archive:c')!.resolve('url-c');
    await tick();
    engine.handlers.playing?.();
  }

  it('хук конца очереди сразу ответил «продолжения не будет» — остановка в начале последнего трека, без вечной «Загрузки…»', async () => {
    player.setQueueEndHook(() => {
      player.usePlayer.getState().appendTracks([]);
      return true;
    });
    await playingLast();
    engine.calls = [];
    engine.handlers.ended?.();
    expect(player.usePlayer.getState()).toMatchObject({ index: 2, isLoading: false, isPlaying: false, positionSec: 0 });
    expect(engine.calls).toContain('seek:0');
    // «Играть» после остановки — снова последний трек, а не ожидание волны.
    player.usePlayer.getState().toggle();
    expect(engine.calls.at(-1)).toBe('play');
  });

  it('хук конца очереди сразу дописал треки — играет первый дописанный', async () => {
    player.setQueueEndHook(() => {
      player.usePlayer.getState().appendTracks([track('d')]);
      return true;
    });
    await playingLast();
    engine.handlers.ended?.();
    expect(player.usePlayer.getState()).toMatchObject({ index: 3, isLoading: true });
    expect(resolveCalls.at(-1)).toBe('archive:d');
    streams.get('archive:d')!.resolve('url-d');
    await tick();
    expect(engine.calls.at(-1)).toBe('load:url-d');
  });

  it('«Следующий» на последнем треке, а хук сразу ответил «продолжения не будет» — трек продолжает играть', async () => {
    player.setQueueEndHook(() => {
      player.usePlayer.getState().appendTracks([]);
      return true;
    });
    await playingLast();
    engine.calls = [];
    player.usePlayer.getState().next();
    expect(player.usePlayer.getState()).toMatchObject({ index: 2, isLoading: false, isPlaying: true });
    expect(engine.calls).not.toContain('pause');
  });

  it('без волны конец очереди — как раньше: остановка', async () => {
    player.setQueueEndHook(null);
    await playingA();
    player.usePlayer.getState().playAt(2);
    streams.get('archive:c')!.resolve('url-c');
    await tick();
    engine.handlers.playing?.();
    engine.handlers.ended?.();
    expect(player.usePlayer.getState()).toMatchObject({ index: 2, isLoading: false, isPlaying: false });
    player.usePlayer.getState().appendTracks([track('d')]);
    expect(player.usePlayer.getState().index).toBe(2);
  });
});

describe('usePlayer: следующие треки готовятся, пока играет текущий', () => {
  /** Очередь YouTube a..f; a загружен и играет. */
  async function playingYt(n = 6): Promise<Track[]> {
    const list = Array.from({ length: n }, (_, i) => ytTrack(String.fromCharCode(97 + i)));
    player.usePlayer.getState().playList(list, 0);
    streams.get('youtube:a')!.resolve('url-a');
    await tick();
    engine.handlers.playing?.();
    await tick();
    return list;
  }

  it('звук следующих 3 треков ищется заранее, начало следующего подгружается во второй <audio>', async () => {
    await playingYt();
    const last = prepareCalls.at(-1)!;
    expect(last.owner).toBe('player');
    expect(last.ids).toEqual(['youtube:a', 'youtube:b', 'youtube:c', 'youtube:d']);
    expect(resolveCalls).toEqual(['youtube:a', 'youtube:b']);
    streams.get('youtube:b')!.resolve('url-b');
    await tick();
    expect(engine.calls).toContain('preload:url-b');
  });

  it('«Далее» на подготовленный трек — звук сразу: загрузка в тот же момент, без нового поиска', async () => {
    await playingYt();
    streams.get('youtube:b')!.resolve('url-b');
    await tick();
    player.usePlayer.getState().next();
    expect(engine.calls.at(-1)).toBe('load:url-b'); // синхронно, до любого ответа main
    expect(resolveCalls.filter((id) => id === 'youtube:b')).toHaveLength(1);
    engine.handlers.playing?.();
    expect(player.usePlayer.getState()).toMatchObject({ index: 1, isPlaying: true, isLoading: false });
  });

  it('автопереход в конце трека — тоже сразу с подготовленного', async () => {
    await playingYt();
    streams.get('youtube:b')!.resolve('url-b');
    await tick();
    engine.handlers.ended?.();
    expect(engine.calls.at(-1)).toBe('load:url-b');
    expect(player.usePlayer.getState().index).toBe(1);
  });

  it('перешли раньше, чем ссылка готова, — ждём тот же запрос, второго поиска нет', async () => {
    await playingYt();
    player.usePlayer.getState().next();
    expect(resolveCalls.filter((id) => id === 'youtube:b')).toHaveLength(1);
    streams.get('youtube:b')!.resolve('url-b');
    await tick();
    expect(engine.calls.at(-1)).toBe('load:url-b');
  });

  it('быстрое листание 10 треков: плеер просит готовить только текущий, не больше 4 треков за раз', async () => {
    await playingYt(14);
    for (let i = 0; i < 10; i++) player.usePlayer.getState().next();
    await tick();
    expect(player.usePlayer.getState().index).toBe(10);
    for (const c of prepareCalls) expect(c.ids.length).toBeLessThanOrEqual(1 + player.PREPARE_AHEAD);
    expect(prepareCalls.at(-1)!.ids[0]).toBe('youtube:k');
    expect(prepareCalls.at(-1)!.ids.length).toBeLessThanOrEqual(1);
  });

  it('очередь сменилась — подготовленный трек не играет вместо нового', async () => {
    await playingYt();
    streams.get('youtube:b')!.resolve('url-b');
    await tick();
    player.usePlayer.getState().playList([ytTrack('x'), ytTrack('b')], 0);
    expect(engine.calls.at(-1)).not.toBe('load:url-b');
    expect(resolveCalls.at(-1)).toBe('youtube:x');
  });
});

describe('usePlayer: события ухода с трека (для вкуса)', () => {
  type Leave = import('./usePlayer').TrackLeaveEvent;
  /** Звучит `sec` секунд: события timeupdate каждые полсекунды от `from`. */
  function playFor(sec: number, from = 0): void {
    for (let t = from + 0.5; t <= from + sec + 1e-9; t += 0.5) engine.handlers.time?.(t);
  }

  it('«Далее» на 10-й секунде — user, сыграно 10 с; трек доиграл — ended', async () => {
    const leaves: Leave[] = [];
    const off = player.usePlayer.getState().onTrackLeave((e) => leaves.push(e));
    await playingA();
    engine.handlers.duration?.(200);
    playFor(10);
    player.usePlayer.getState().next();
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toMatchObject({ track: { id: 'archive:a' }, cause: 'user', durationSec: 200 });
    expect(leaves[0].playedSec).toBeCloseTo(10);

    streams.get('archive:b')!.resolve('url-b');
    await tick();
    engine.handlers.playing?.();
    engine.handlers.duration?.(5);
    playFor(5);
    engine.handlers.ended?.();
    expect(leaves).toHaveLength(2);
    expect(leaves[1]).toMatchObject({ track: { id: 'archive:b' }, cause: 'ended', durationSec: 5 });
    expect(leaves[1].playedSec).toBeCloseTo(5);

    off();
    player.usePlayer.getState().next();
    expect(leaves).toHaveLength(2);
  });

  it('перемотка вперёд не считается звучанием; повтор того же трека — не уход', async () => {
    const leaves: Leave[] = [];
    player.usePlayer.getState().onTrackLeave((e) => leaves.push(e));
    await playingA();
    playFor(3);
    engine.handlers.time?.(120); // перемотка
    playFor(2, 120);
    player.usePlayer.getState().playAt(0); // тот же трек сначала
    expect(leaves).toEqual([]);
    player.usePlayer.getState().playList([track('x')], 0);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].cause).toBe('user');
    expect(leaves[0].playedSec).toBeCloseTo(5);
  });

  it('недоступный трек — error при переходе к следующему', async () => {
    const leaves: Leave[] = [];
    player.usePlayer.getState().onTrackLeave((e) => leaves.push(e));
    await playingA();
    engine.handlers.error?.();
    expect(leaves.map((e) => [e.track.id, e.cause])).toEqual([['archive:a', 'error']]);
  });

  it('playList с заголовком — заголовок очереди; без него — пусто', () => {
    player.usePlayer.getState().playList([track('a')], 0, 'Мне нравится');
    expect(player.usePlayer.getState().queueTitle).toBe('Мне нравится');
    player.usePlayer.getState().playList([track('b')], 0);
    expect(player.usePlayer.getState().queueTitle).toBeUndefined();
  });
});

describe('usePlayer: скрытые треки (чёрный список) пропускаются', () => {
  type Leave = import('./usePlayer').TrackLeaveEvent;
  const library = async () => (await import('./useLibrary')).useLibrary.getState();
  const ids = () => player.usePlayer.getState().queue.map((t) => t.id);
  const currentId = () => {
    const s = player.usePlayer.getState();
    return s.queue[s.index]?.id;
  };

  it('«Далее» и автопереход перескакивают скрытый трек; уход с него не сообщается (для вкуса это не пропуск)', async () => {
    (await library()).blockTrack(track('b'));
    const leaves: Leave[] = [];
    player.usePlayer.getState().onTrackLeave((e) => leaves.push(e));
    player.usePlayer.getState().playList([track('a'), track('b'), track('c'), track('d')], 0);
    player.usePlayer.getState().next();
    expect(currentId()).toBe('archive:c');
    expect(resolveCalls).not.toContain('archive:b');
    expect(leaves.map((e) => e.track.id)).toEqual(['archive:a']);

    // Скрытый посреди списка — и при естественном конце трека.
    (await library()).blockTrack(track('d'));
    player.usePlayer.getState().playList([track('a'), track('b'), track('c')], 0);
    streams.get('archive:a')!.resolve('url-a');
    await tick();
    engine.handlers.playing?.();
    engine.handlers.ended?.();
    expect(currentId()).toBe('archive:c');
    expect(ids()).toEqual(['archive:a', 'archive:b', 'archive:c']); // свои списки не меняются
  });

  it('«Назад» перескакивает скрытый трек', async () => {
    (await library()).blockTrack(track('b'));
    player.usePlayer.getState().playList([track('a'), track('b'), track('c')], 2);
    player.usePlayer.getState().prev();
    expect(currentId()).toBe('archive:a');
  });

  it('старт списка со скрытого трека — играет следующий не скрытый; все скрыты — ничего не играет, тост', async () => {
    const lib = await library();
    lib.blockTrack(track('a'));
    lib.blockArtist({ name: 'Плохой' });
    const feat: Track = { ...track('f'), artist: 'Другой', title: 'Песня (feat. Плохой)' };
    player.usePlayer.getState().playList([track('a'), feat, track('c')], 0);
    expect(currentId()).toBe('archive:c');
    expect(resolveCalls).toEqual(['archive:c']);

    resolveCalls = [];
    const toasts = ui.useUi.getState().toasts.length;
    player.usePlayer.getState().playList([track('a'), feat], 0);
    expect(resolveCalls).toEqual([]);
    expect(currentId()).toBe('archive:c');
    expect(ui.useUi.getState().toasts.length).toBe(toasts + 1);
  });

  it('скрытые не готовятся заранее: следующими считаются только те, что заиграют', async () => {
    (await library()).blockTrack(ytTrack('b'));
    const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ytTrack(id));
    player.usePlayer.getState().playList(list, 0);
    streams.get('youtube:a')!.resolve('url-a');
    await tick();
    engine.handlers.playing?.();
    await tick();
    expect(prepareCalls.at(-1)!.ids).toEqual(['youtube:a', 'youtube:c', 'youtube:d', 'youtube:e']);
    expect(resolveCalls).toEqual(['youtube:a', 'youtube:c']);
  });
});
