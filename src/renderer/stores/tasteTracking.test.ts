import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngineEvents } from '../audioEngine';
import type { Track } from '../../shared/types';

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

const track = (id: string, artist: string, title = `Песня ${id}`): Track => ({
  id: `archive:${id}`,
  source: 'archive',
  sourceId: `${id}.mp3`,
  title,
  artist,
  downloadable: true,
});

let streams: Map<string, (url: string) => void>;
let initial: import('../../shared/types').LibraryData;
let library: typeof import('./useLibrary');
let player: typeof import('./usePlayer');
let tracking: typeof import('./tasteTracking');

const tick = () => new Promise((r) => setTimeout(r, 0));
const p = () => player.usePlayer.getState();
const events = () => library.useLibrary.getState().lib.taste.events.map((e) => [e.artist, e.kind]);

/** Текущий трек загрузился и звучит `sec` секунд. */
async function sounds(id: string, sec: number, durationSec: number): Promise<void> {
  streams.get(`archive:${id}`)!(`url-${id}`);
  await tick();
  engine.handlers.playing?.();
  engine.handlers.duration?.(durationSec);
  for (let t = 0.5; t <= sec + 1e-9; t += 0.5) engine.handlers.time?.(t);
}

beforeEach(async () => {
  vi.resetModules();
  engine.handlers = {};
  streams = new Map();
  initial = (await import('../../shared/library')).emptyLibrary();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    aura: {
      resolveStream: (t: Track) => new Promise<string>((resolve) => streams.set(t.id, resolve)),
      prepareStreams: async () => undefined,
      library: { load: async () => initial, save: async () => undefined },
      onBeforeClose: () => () => undefined,
    },
  });
  library = await import('./useLibrary');
  player = await import('./usePlayer');
  tracking = await import('./tasteTracking');
});

/** Трекер подключён до загрузки библиотеки — загрузка не должна давать событий. */
async function start(): Promise<void> {
  tracking.initTasteTracking();
  await library.useLibrary.getState().load();
}

describe('трекер вкуса', () => {
  it('«Далее» раньше 30 с — пропуск каждому исполнителю трека; доиграл — «дослушал»', async () => {
    await start();
    p().playList([track('a', 'X feat. Y'), track('b', 'Z', 'Песня (feat. W)'), track('c', 'Q')], 0);
    await sounds('a', 10, 200);
    p().next();
    expect(events()).toEqual([
      ['X', 'skip'],
      ['Y', 'skip'],
    ]);

    await sounds('b', 180, 180);
    engine.handlers.ended?.();
    expect(events().slice(2)).toEqual([
      ['Z', 'complete'],
      ['W', 'complete'],
    ]);
  });

  it('сыграно ≥ 80 % — «дослушал» и при «Далее»; ушёл после 30 с, но раньше 80 % — ничего', async () => {
    await start();
    p().playList([track('a', 'A'), track('b', 'B'), track('c', 'C')], 0);
    await sounds('a', 85, 100);
    p().next();
    await sounds('b', 40, 200);
    p().next();
    expect(events()).toEqual([['A', 'complete']]);
  });

  it('ушёл, не услышав ни секунды (звук ещё грузился), — ни пропуска, ни «дослушал»', async () => {
    await start();
    p().playList([track('a', 'A'), track('b', 'B'), track('c', 'C')], 0);
    p().next(); // «a» так и не зазвучал
    await sounds('b', 0, 200); // «b» загрузился, но ушли сразу
    p().next();
    expect(events()).toEqual([]);
    expect(tracking.leaveKind({ track: track('x', 'X'), playedSec: 0, durationSec: 0, cause: 'ended' })).toBeNull();
  });

  it('скрытый трек («Не нравится» с переходом дальше) не получает ещё и пропуск', async () => {
    await start();
    const a = track('a', 'A');
    p().playList([a, track('b', 'B')], 0);
    await sounds('a', 5, 100);
    library.useLibrary.getState().blockTrack(a);
    p().next();
    expect(events()).toEqual([]);
  });

  it('лайк и подписка — во вкус; загрузка библиотеки с лайками и подписками — нет', async () => {
    const ops = await import('../../shared/library');
    initial = ops.followArtist(ops.toggleLike(ops.emptyLibrary(), track('old', 'Old')), { id: '9', name: 'OldFollow' });
    await start();
    expect(events()).toEqual([]);
    library.useLibrary.getState().toggleLike(track('l', 'Liked & Co'));
    library.useLibrary.getState().follow({ id: '1', name: 'Followed' });
    expect(events()).toEqual([
      ['Liked', 'like'],
      ['Co', 'like'],
      ['Followed', 'follow'],
    ]);
    library.useLibrary.getState().toggleLike(track('l', 'Liked & Co')); // снял лайк — ничего
    expect(events()).toHaveLength(3);
  });
});
