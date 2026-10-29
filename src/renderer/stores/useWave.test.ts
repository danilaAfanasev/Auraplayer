import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaveMoreRequest, WaveSeed } from '../../shared/api';
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

/** Трек; у каждого свой исполнитель, если не задан — правило «не больше 2 подряд» не мешает. */
const track = (id: string, artist = `Исполнитель ${id}`): Track => ({
  id: `archive:${id}`,
  source: 'archive',
  sourceId: `item/${id}.mp3`,
  title: `Песня ${id}`,
  artist,
  downloadable: true,
});
const tracks = (prefix: string, n: number): Track[] => Array.from({ length: n }, (_, i) => track(`${prefix}${i}`));
const ids = (list: readonly Track[]) => list.map((t) => t.id);

interface Deferred<T> {
  resolve(v: T): void;
  reject(err: unknown): void;
}
function deferred<T>(): { promise: Promise<T> } & Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let startCalls: (Deferred<Track[]> & { seed: WaveSeed })[];
let moreCalls: (Deferred<Track[]> & { req: WaveMoreRequest })[];
let streams: Map<string, Deferred<string>>;
/** Порядок запросов звука (проверка волны и проигрывание). */
let resolveLog: string[];
/** Запросы звука, на которые тест уже ответил. */
let resolved: Set<string>;
let prepareCalls: { owner: string; ids: string[] }[];
let player: typeof import('./usePlayer');
let wave: typeof import('./useWave');
let ui: typeof import('./useUi');

const tick = () => new Promise((r) => setTimeout(r, 0));
const p = () => player.usePlayer.getState();
const w = () => wave.useWave.getState();

beforeEach(async () => {
  vi.resetModules();
  engine.handlers = {};
  startCalls = [];
  moreCalls = [];
  streams = new Map();
  resolveLog = [];
  resolved = new Set();
  prepareCalls = [];
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    aura: {
      resolveStream: (t: Track) =>
        new Promise<string>((resolve, reject) => {
          resolveLog.push(t.id);
          streams.set(t.id, { resolve, reject });
        }),
      prepareStreams: async (owner: string, list: Track[]) => {
        prepareCalls.push({ owner, ids: list.map((t) => t.id) });
      },
      wave: {
        start: (seed: WaveSeed) => {
          const d = deferred<Track[]>();
          startCalls.push({ ...d, seed });
          return d.promise;
        },
        more: (req: WaveMoreRequest) => {
          const d = deferred<Track[]>();
          moreCalls.push({ ...d, req });
          return d.promise;
        },
      },
    },
  });
  player = await import('./usePlayer');
  wave = await import('./useWave');
  ui = await import('./useUi');
});

/** Текущий трек плеера загрузился и играет. */
async function current(): Promise<void> {
  const id = p().queue[p().index].id;
  streams.get(id)!.resolve(`url-${id}`);
  await tick();
  engine.handlers.playing?.();
}

/** Ответить на все ждущие запросы дополнения пустым списком. */
async function answerMoreEmpty(): Promise<void> {
  for (let i = 0; i < 5 && moreCalls.length > 0; i++) {
    const pending = moreCalls.splice(0);
    for (const c of pending) c.resolve([]);
    await tick();
  }
}

describe('useWave: включение', () => {
  it('волна без лид-треков: индикатор на кнопке, потом очередь — подобранные треки, играет первый', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] }, 'chip-phonk');
    expect(w()).toMatchObject({ starting: 'chip-phonk', active: null });
    startCalls[0].resolve(tracks('c', 5));
    await tick();
    expect(w()).toMatchObject({ starting: null, active: { title: 'Фонк' } });
    expect(ids(p().queue)).toEqual(ids(tracks('c', 5)));
    expect(p().index).toBe(0);
  });

  it('волна по треку: трек играет сразу, похожие дописываются после него без дублей', async () => {
    const lead = track('lead');
    void w().start({ title: 'Песня lead', lead: [lead], tracks: [lead] });
    expect(w().active).toEqual({ title: 'Песня lead' });
    expect(ids(p().queue)).toEqual([lead.id]);
    startCalls[0].resolve([lead, ...tracks('s', 4)]);
    await tick();
    expect(ids(p().queue)).toEqual([lead.id, ...ids(tracks('s', 4))]);
    expect(p().index).toBe(0);
  });

  it('пользователь включил другой список, пока волна без лид-треков подбиралась, — волна отменяется и его очередь не трогает', async () => {
    void w().start({ title: 'Моя волна', artists: ['madk1d'] }, 'my-wave');
    const album = tracks('album', 3);
    p().playList(album, 0);
    expect(w()).toMatchObject({ starting: null, active: null });

    startCalls[0].resolve(tracks('c', 5));
    await tick();
    expect(ids(p().queue)).toEqual(ids(album));
    expect(w()).toMatchObject({ starting: null, active: null });
  });

  it('волна не подобралась — тост и выключение', async () => {
    void w().start({ title: 'Своя волна', text: 'нечто' }, 'own');
    startCalls[0].resolve([]);
    await tick();
    expect(w()).toMatchObject({ starting: null, active: null });
    expect(ui.useUi.getState().toasts.at(-1)?.kind).toBe('error');
  });
});

describe('useWave: дополнение очереди', () => {
  it('до конца очереди меньше трёх треков — дописываются следующие, недавние треки — сиды', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve(tracks('c', 4));
    await tick();
    await current();
    expect(moreCalls).toHaveLength(0); // впереди 3 трека
    p().next();
    expect(moreCalls).toHaveLength(1); // впереди 2
    expect(ids(moreCalls[0].req.recent)).toEqual(ids(tracks('c', 2)));
    expect(w().refilling).toBe(true);

    moreCalls[0].resolve([track('c0'), ...tracks('m', 3)]); // c0 уже был в волне
    await tick();
    expect(ids(p().queue)).toEqual([...ids(tracks('c', 4)), ...ids(tracks('m', 3))]);
    expect(w().refilling).toBe(false);
  });

  it('пока идёт первый подбор волны, дополнение не запускается; конец очереди ждёт его ответа', async () => {
    const lead = track('lead');
    void w().start({ title: 'Песня lead', lead: [lead], tracks: [lead] });
    await current();
    expect(moreCalls).toHaveLength(0);

    engine.handlers.ended?.(); // лид-трек кончился раньше, чем пришли похожие
    expect(moreCalls).toHaveLength(0);
    expect(p()).toMatchObject({ index: 0, isLoading: true });

    startCalls[0].resolve(tracks('s', 5));
    await tick();
    expect(p().index).toBe(1);
    expect(p().queue[1].id).toBe('archive:s0');
  });

  it('первый подбор с лид-треком не дал треков — дальше обычное дополнение, ожидание в конце очереди снимается', async () => {
    const lead = track('lead');
    void w().start({ title: 'Песня lead', lead: [lead], tracks: [lead] });
    await current();
    engine.handlers.ended?.();
    startCalls[0].resolve([]);
    await tick();
    expect(moreCalls).toHaveLength(1);
    moreCalls[0].resolve(tracks('m', 3));
    await tick();
    expect(p().index).toBe(1);
    expect(p().queue[1].id).toBe('archive:m0');
  });

  it('дополнение не удалось на последнем треке — по его концу плеер останавливается, а не висит в «Загрузке…»', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve(tracks('c', 1));
    await tick();
    await current();
    await answerMoreEmpty(); // три попытки — пусто
    expect(w().refilling).toBe(false);

    engine.handlers.ended?.();
    expect(p()).toMatchObject({ index: 0, isLoading: false, isPlaying: false });
  });
});

describe('useWave: выключение и «Не нравится»', () => {
  it('выключение во время дополнения: ответ отбрасывается, очередь остаётся обычной', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve(tracks('c', 2));
    await tick();
    await current();
    expect(moreCalls).toHaveLength(1);

    w().stop();
    expect(w()).toMatchObject({ active: null, refilling: false });
    moreCalls[0].resolve(tracks('m', 3));
    await tick();
    expect(ids(p().queue)).toEqual(ids(tracks('c', 2)));

    // Конец очереди без волны — обычная остановка.
    p().next();
    await current();
    engine.handlers.ended?.();
    expect(p()).toMatchObject({ index: 1, isLoading: false, isPlaying: false });
    expect(moreCalls).toHaveLength(1);
  });

  it('«Не нравится» — трек в чёрный список навсегда: следующий трек, та же песня не вернётся ни в порцию, ни в новую волну', async () => {
    const { useLibrary } = await import('./useLibrary');
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    // Второй трек «Плохого» в 10 подряд не встал бы (окно исполнителей) — здесь другой исполнитель.
    const list = [track('a1', 'Плохой'), track('b1'), track('a2'), track('b2')];
    startCalls[0].resolve(list);
    await tick();
    await current();
    p().next(); // b1; впереди 2 — дополнение уходит
    await current();
    expect(moreCalls).toHaveLength(1);

    p().playAt(0); // вернулись к a1 — «Не нравится» на нём
    await current();
    w().dislike();
    expect(useLibrary.getState().lib.blacklist.tracks.map((b) => b.track.id)).toEqual(['archive:a1']);
    // Скрыт только трек: исполнитель в чёрный список не уходит.
    expect(useLibrary.getState().lib.blacklist.artists).toEqual([]);
    expect(ids(p().queue)).toEqual(['archive:a1', 'archive:b1', 'archive:a2', 'archive:b2']);
    expect(p().queue[p().index].id).toBe('archive:b1');
    expect(w().active).toEqual({ title: 'Фонк' });

    // Та же песня с другим id (другой источник) — не попадает в догружаемую порцию.
    const sameSong: Track = { ...track('yt-a1', 'Плохой'), id: 'youtube:a1', source: 'youtube', title: 'Песня a1' };
    moreCalls[0].resolve([sameSong, track('m1')]);
    await tick();
    expect(ids(p().queue)).toEqual(['archive:a1', 'archive:b1', 'archive:a2', 'archive:b2', 'archive:m1']);

    // Новая волна — тоже без неё.
    void w().start({ title: 'Рэп', queries: ['rap'] });
    startCalls[1].resolve([track('a1', 'Плохой'), track('n1')]);
    await tick();
    expect(ids(p().queue)).toEqual(['archive:n1']);
  });
});

describe('useWave: удаление будущих треков снаружи', () => {
  it('«Убрать из очереди» (removeUpcoming не от волны) — волна не выключается и дописывается дальше', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve(tracks('c', 5));
    await tick();
    await current();
    p().removeUpcoming((t) => t.id === 'archive:c1' || t.id === 'archive:c3');
    expect(ids(p().queue)).toEqual(['archive:c0', 'archive:c2', 'archive:c4']);
    expect(w().active).toEqual({ title: 'Фонк' });

    p().next(); // c2: впереди 1 — пора дописывать
    expect(moreCalls).toHaveLength(1);
    moreCalls[0].resolve(tracks('m', 2));
    await tick();
    expect(ids(p().queue)).toEqual(['archive:c0', 'archive:c2', 'archive:c4', 'archive:m0', 'archive:m1']);
    expect(w().active).toEqual({ title: 'Фонк' });
  });

  it('«Играть следующим» во время волны — трек встаёт за текущим, волна не выключается; переезд будущего — тоже', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve(tracks('c', 5));
    await tick();
    await current();
    p().playNext(track('x'));
    expect(ids(p().queue)).toEqual(['archive:c0', 'archive:x', 'archive:c1', 'archive:c2', 'archive:c3', 'archive:c4']);
    expect(w().active).toEqual({ title: 'Фонк' });
    p().playNext(track('c3'));
    expect(ids(p().queue)).toEqual(['archive:c0', 'archive:c3', 'archive:x', 'archive:c1', 'archive:c2', 'archive:c4']);
    expect(w().active).toEqual({ title: 'Фонк' });
    // Правка очереди перезапускает подготовку следующих через 300 мс — дожидаемся её здесь, а не в чужом тесте.
    await new Promise((r) => setTimeout(r, 350));
  });
});

describe('useWave: чёрный список', () => {
  async function blockSome(): Promise<void> {
    const { useLibrary } = await import('./useLibrary');
    useLibrary.getState().blockTrack(track('x'));
    useLibrary.getState().blockArtist({ name: 'Плохой' });
  }
  const hidden = (): Track[] => [
    track('x'),
    { ...track('x2'), id: 'soundcloud:x2', source: 'soundcloud', title: 'Песня x', artist: 'Исполнитель x' }, // та же песня
    track('p1', 'Плохой'),
    track('p2', 'Кто-то feat. Плохой'),
    { ...track('p3', 'Другой'), title: 'Песня (feat. Плохой)' },
  ];

  it('новая волна не ставит скрытый трек (и ту же песню из другого источника) и треки скрытого исполнителя, в том числе на фите', async () => {
    await blockSome();
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve([...hidden(), track('ok1'), track('ok2')]);
    await tick();
    // Звук трека SoundCloud проверяется — пусть найдётся, если он вдруг дошёл до проверки.
    for (const [id, d] of streams) if (id.startsWith('soundcloud:')) d.resolve('url');
    await tick();
    expect(ids(p().queue)).toEqual(['archive:ok1', 'archive:ok2']);
  });

  it('автопродолжение после конца списка тоже без скрытых', async () => {
    await blockSome();
    p().playList([track('a')], 0);
    await current();
    engine.handlers.ended?.();
    startCalls[0].resolve([...hidden(), track('s1')]);
    await tick();
    for (const [id, d] of streams) if (id.startsWith('soundcloud:')) d.resolve('url');
    await tick();
    expect(ids(p().queue)).toEqual(['archive:a', 'archive:s1']);
  });

  it('исполнителя добавили в чёрный список во время волны — его треки уходят из очереди, волна продолжается', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve([track('b1'), track('p1', 'Плохой'), track('b2'), track('b3')]);
    await tick();
    await current();
    const { blockArtistEverywhere } = await import('./blacklistActions');
    blockArtistEverywhere({ name: 'Плохой' });
    expect(ids(p().queue)).toEqual(['archive:b1', 'archive:b2', 'archive:b3']);
    expect(w().active).toEqual({ title: 'Фонк' });
  });
});

describe('useWave: похожие после конца обычного списка', () => {
  /** Обычная очередь (поиск, плейлист…) — не волна. */
  async function playOrdinary(list: Track[]): Promise<void> {
    p().playList(list, 0);
    await current();
  }

  it('трек из поиска доиграл — волна похожих на него сама продолжает, в плеере видно волну', async () => {
    const found = track('madk1d', 'madk1d');
    await playOrdinary([found]);
    engine.handlers.ended?.();
    expect(startCalls).toHaveLength(1);
    expect(ids(startCalls[0].seed.tracks ?? [])).toEqual([found.id]);
    expect(startCalls[0].seed.lead ?? []).toEqual([]);
    expect(w().active).toEqual({ title: 'похожие на Песня madk1d' });
    expect(p()).toMatchObject({ index: 0, isLoading: true });

    startCalls[0].resolve([found, ...tracks('s', 4)]);
    await tick();
    expect(ids(p().queue)).toEqual([found.id, ...ids(tracks('s', 4))]);
    expect(p().index).toBe(1);
  });

  it('выключение такой волны: дальше очередь обычная, в её конце — остановка без новой волны', async () => {
    await playOrdinary([track('a')]);
    engine.handlers.ended?.();
    startCalls[0].resolve(tracks('s', 2));
    await tick();
    await current();
    w().stop();
    expect(w().active).toBeNull();

    p().next();
    await current();
    engine.handlers.ended?.();
    expect(p()).toMatchObject({ index: 2, isLoading: false, isPlaying: false });
    expect(startCalls).toHaveLength(1);
    expect(w().active).toBeNull();
  });

  it('пользователь включил другой список, пока похожие подбирались, — волна отменяется, его очередь не трогается', async () => {
    await playOrdinary([track('a')]);
    engine.handlers.ended?.();
    const album = tracks('album', 3);
    p().playList(album, 0);
    expect(w().active).toBeNull();
    startCalls[0].resolve(tracks('s', 3));
    await tick();
    expect(ids(p().queue)).toEqual(ids(album));
  });

  it('похожие не подобрались — остановка, а не вечная «Загрузка…»', async () => {
    await playOrdinary([track('a')]);
    engine.handlers.ended?.();
    startCalls[0].resolve([]);
    await tick();
    expect(p()).toMatchObject({ index: 0, isLoading: false, isPlaying: false });
    expect(w().active).toBeNull();
  });

  it('повтор «всё» и «один» — как раньше: волна не включается', async () => {
    await playOrdinary(tracks('r', 2));
    p().cycleRepeat(); // всё
    p().next();
    await current();
    engine.handlers.ended?.();
    expect(p().index).toBe(0);
    p().cycleRepeat(); // один
    await current();
    engine.handlers.ended?.();
    expect(p().index).toBe(0);
    expect(startCalls).toHaveLength(0);
    expect(w().active).toBeNull();
  });

  it('переключатель «Похожие после конца списка» выключен — остановка как раньше', async () => {
    const { useSettings } = await import('./useSettings');
    useSettings.setState({ settings: { ...useSettings.getState().settings, waveAfterQueue: false } });
    await playOrdinary([track('a')]);
    engine.handlers.ended?.();
    expect(startCalls).toHaveLength(0);
    expect(p()).toMatchObject({ index: 0, isLoading: false, isPlaying: false });
  });
});

describe('useWave: в очередь — только треки с найденным звуком', () => {
  /** Трек каталога: его звук ищет yt-dlp и может не найти. */
  const cat = (id: string): Track => ({ id: `catalog:${id}`, source: 'catalog', sourceId: id, title: `Песня ${id}`, artist: `Исполнитель ${id}`, downloadable: true });
  const cats = (n: number) => Array.from({ length: n }, (_, i) => cat(`c${i}`));

  it('звук не нашёлся — трек тихо выкидывается, вместо него встаёт следующий; «Не удалось загрузить» не появляется', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] }, 'chip');
    startCalls[0].resolve(cats(6));
    await tick();
    // Проверяются первые два; волна ещё не в плеере — кнопка показывает загрузку.
    expect(resolveLog).toEqual(['catalog:c0', 'catalog:c1']);
    expect(w()).toMatchObject({ active: null, starting: 'chip' });
    streams.get('catalog:c0')!.reject(new Error('Не удалось найти звук для этого трека'));
    await tick();
    streams.get('catalog:c1')!.resolve('url-c1');
    await tick();
    expect(w()).toMatchObject({ active: { title: 'Фонк' }, starting: null });
    expect(p().queue[0].id).toBe('catalog:c1');
    expect(ids(p().queue)).not.toContain('catalog:c0');
    expect(ui.useUi.getState().toasts).toEqual([]);
  });

  it('проверка — не больше 2 треков сразу и не дальше нескольких вперёд; main готовит их звук как «wave»', async () => {
    void w().start({ title: 'Фонк', queries: ['phonk'] });
    startCalls[0].resolve(cats(12));
    await tick();
    expect(resolveLog).toHaveLength(2);
    expect(prepareCalls.at(-1)).toEqual({ owner: 'wave', ids: ['catalog:c0', 'catalog:c1'] });
    for (let i = 0; i < 8; i++) {
      const pending = [...streams.entries()].filter(([id]) => id.startsWith('catalog:c') && !resolved.has(id));
      for (const [id, d] of pending) {
        resolved.add(id);
        d.resolve(`url-${id}`);
      }
      await tick();
    }
    // Впереди не больше нескольких проверенных: остальное ждёт, пока очередь сдвинется.
    expect(p().queue.length).toBeLessThanOrEqual(1 + 4);
    expect(p().queue.length).toBeGreaterThanOrEqual(3);
    expect(new Set(resolveLog.filter((id) => id !== p().queue[0].id)).size).toBeLessThanOrEqual(5);
  });

  it('дополнение волны: дописываются только проверенные, без звука — пропускаются', async () => {
    const lead = track('lead');
    void w().start({ title: 'Песня lead', lead: [lead], tracks: [lead] });
    await current();
    startCalls[0].resolve([cat('x0'), cat('x1'), cat('x2')]);
    await tick();
    streams.get('catalog:x0')!.resolve('url-x0');
    streams.get('catalog:x1')!.reject(new Error('Не удалось найти звук для этого трека'));
    await tick();
    await tick();
    streams.get('catalog:x2')!.resolve('url-x2');
    await tick();
    expect(ids(p().queue)).toEqual([lead.id, 'catalog:x0', 'catalog:x2']);
  });
});

describe('useWave: волна SoundCloud', () => {
  const sc = (id: string, artist = `SC ${id}`): Track => ({
    id: `soundcloud:${id}`,
    source: 'soundcloud',
    sourceId: id,
    title: `Трек ${id}`,
    artist,
    downloadable: true,
  });

  it('сид «Волны SoundCloud»: недавние треки SoundCloud, затем лайки SoundCloud; без них — первый трек популярного', async () => {
    const { emptyLibrary } = await import('../../shared/library');
    const lib = emptyLibrary();
    const other = track('x');
    lib.tracks = { [sc('1').id]: sc('1'), [sc('2').id]: sc('2'), [sc('3').id]: sc('3'), [other.id]: other };
    lib.history = [
      { trackId: other.id, playedAt: 3 },
      { trackId: sc('2').id, playedAt: 2 },
    ];
    lib.likes = [sc('3').id, other.id, sc('2').id];
    const seed = wave.soundcloudWaveSeed(lib, [sc('9')]);
    expect(seed?.title).toBe('Волна SoundCloud');
    expect(ids(seed?.tracks ?? [])).toEqual([sc('2').id, sc('3').id]);

    expect(ids(wave.soundcloudWaveSeed(emptyLibrary(), [sc('9'), sc('8')])?.tracks ?? [])).toEqual([sc('9').id]);
    expect(wave.soundcloudWaveSeed(emptyLibrary(), [])).toBeNull();
  });

  it('трек SoundCloud доиграл при выключенном YouTube — похожие (рекомендации SoundCloud) всё равно продолжают', async () => {
    const { useSettings } = await import('./useSettings');
    useSettings.setState({ settings: { ...useSettings.getState().settings, youtubeEnabled: false, soundcloudEnabled: true } });
    p().playList([sc('1')], 0);
    await current();
    engine.handlers.ended?.();
    expect(startCalls).toHaveLength(1);
    expect(ids(startCalls[0].seed.tracks ?? [])).toEqual([sc('1').id]);
  });
});

describe('useWave: разнообразие — 10 разных исполнителей, лайки реже', () => {
  /** Исполнители очереди: первая пара позиций, где один исполнитель ближе `window` треков; нет — null. */
  async function repeatWithin(list: readonly Track[], window: number): Promise<[number, number] | null> {
    const { artistKeys } = await import('../../shared/wave');
    const keys = list.map((x) => artistKeys(x.artist, x.title));
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < Math.min(keys.length, i + window); j++) if (keys[i].some((k) => keys[j].includes(k))) return [i, j];
    }
    return null;
  }

  it('песни из «Мне нравится» — не больше одной на 10 подряд (вкус из лайков), остальное — не из лайков', async () => {
    const { useLibrary } = await import('./useLibrary');
    const liked = Array.from({ length: 15 }, (_, i) => track(`l${i}`, `Любимый ${i}`));
    for (const t of liked) useLibrary.getState().toggleLike(t);
    const lead = liked[0];
    void w().start({ title: 'Песня l0', lead: [lead], tracks: [lead] });
    await current();
    const other = Array.from({ length: 15 }, (_, i) => track(`n${i}`, `Новый ${i}`));
    // Похожие — вперемешку лайкнутые и новые, лайкнутые первыми.
    startCalls[0].resolve(liked.slice(1).flatMap((t, i) => [t, other[i]]));
    await tick();
    const queue = p().queue;
    expect(queue.length).toBeGreaterThanOrEqual(10);
    const likedIds = new Set(ids(liked));
    for (let i = 0; i + 10 <= queue.length; i++) expect(queue.slice(i, i + 10).filter((t) => likedIds.has(t.id)).length).toBeLessThanOrEqual(1);
  });

  it('мало кандидатов: строгое окно ничего не дало — догрузка, затем окно 5; волна играет, повтор не ближе 5', async () => {
    const lead = track('A1', 'A');
    void w().start({ title: 'Песня A1', lead: [lead], tracks: [lead] });
    await current();
    startCalls[0].resolve(['B', 'C', 'D', 'E', 'F'].map((a) => track(`${a}1`, a)));
    await tick();
    expect(p().queue.map((t) => t.artist)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    for (let i = 0; i < 3; i++) p().next();
    await tick();
    // Строгое окно: все шесть исполнителей ещё в окне — кандидатов нет, догрузка.
    moreCalls.shift()!.resolve(['A', 'B', 'C'].map((a) => track(`${a}2`, a)));
    await tick();
    expect(p().queue).toHaveLength(6);
    moreCalls.shift()!.resolve(['A', 'B'].map((a) => track(`${a}3`, a)));
    await tick();
    expect(p().queue).toHaveLength(6);
    // Последняя попытка — окно 5: A и B (дальше 4 последних) встают, F (только что играл) — нет.
    moreCalls.shift()!.resolve([track('F4', 'F'), track('A4', 'A'), track('B4', 'B')]);
    await tick();
    expect(p().queue.map((t) => t.artist)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'A', 'B']);
    expect(await repeatWithin(p().queue, 5)).toBeNull();
  });

  it('трек без звука выпал — следующий за ним не встаёт ближе окна к тому же исполнителю', async () => {
    const cat = (id: string, artist: string): Track => ({ id: `catalog:${id}`, source: 'catalog', sourceId: id, title: `Песня ${id}`, artist, downloadable: true });
    const lead = track('x0', 'X');
    void w().start({ title: 'Песня x0', lead: [lead], tracks: [lead] });
    await current();
    // План: X, P1…P9, X — ровно через 10. P5 без звука выпадет — второй X оказался бы через 9.
    const plan = [...Array.from({ length: 9 }, (_, i) => cat(`p${i + 1}`, `P${i + 1}`)), cat('x1', 'X'), cat('q1', 'Q'), cat('q2', 'R')];
    startCalls[0].resolve(plan);
    for (let step = 0; step < 40; step++) {
      await tick();
      for (const [id, d] of streams) {
        if (resolved.has(id) || !id.startsWith('catalog:')) continue;
        resolved.add(id);
        if (id === 'catalog:p5') d.reject(new Error('Не удалось найти звук для этого трека'));
        else d.resolve(`url-${id}`);
      }
      if (p().index < p().queue.length - 1) p().next();
      for (const c of moreCalls.splice(0)) c.resolve([]);
    }
    const queue = p().queue;
    expect(ids(queue)).not.toContain('catalog:p5');
    expect(await repeatWithin(queue, 10)).toBeNull();
  });
});
