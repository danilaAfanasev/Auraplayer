import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../shared/types';

vi.mock('../audioEngine', () => ({
  audioEngine: {
    on: () => undefined,
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

const track = (id: string, artist = `Исполнитель ${id}`, title = `Песня ${id}`): Track => ({
  id: `archive:${id}`,
  source: 'archive',
  sourceId: `${id}.mp3`,
  title,
  artist,
  downloadable: true,
});

let actions: typeof import('./blacklistActions');
let library: typeof import('./useLibrary');
let player: typeof import('./usePlayer');
let ui: typeof import('./useUi');
let blacklist: typeof import('../../shared/blacklist');

const lib = () => library.useLibrary.getState().lib;
const p = () => player.usePlayer.getState();
const ids = (list: Track[]) => list.map((t) => t.id);
const lastToast = () => ui.useUi.getState().toasts.at(-1)!;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    aura: {
      resolveStream: () => new Promise<string>(() => undefined),
      prepareStreams: async () => undefined,
      library: { load: async () => (await import('../../shared/library')).emptyLibrary(), save: async () => undefined },
      settings: { load: async () => undefined, save: async () => undefined },
      onBeforeClose: () => () => undefined,
    },
  });
  actions = await import('./blacklistActions');
  library = await import('./useLibrary');
  player = await import('./usePlayer');
  ui = await import('./useUi');
  blacklist = await import('../../shared/blacklist');
  await library.useLibrary.getState().load();
});

describe('dislikeTrack / restoreTrack', () => {
  it('скрывает трек, снимает лайк, убирает его из будущей очереди и показывает тост с «Вернуть»', () => {
    const [a, b, c] = [track('a'), track('b'), track('c')];
    library.useLibrary.getState().toggleLike(c);
    p().playList([a, b, c], 0);

    actions.dislikeTrack(c);
    expect(blacklist.isBlocked(c, lib().blacklist)).toBe(true);
    expect(lib().likes).toEqual([]);
    expect(ids(p().queue)).toEqual([a.id, b.id]);
    expect(p().queue[p().index].id).toBe(a.id);
    expect(lastToast()).toMatchObject({ text: 'Трек скрыт', action: { label: 'Вернуть' } });
    // «Не нравится» — во вкус исполнителю трека
    expect(lib().taste.events.map((e) => [e.artist, e.kind])).toEqual([['Исполнитель c', 'dislike']]);

    lastToast().action!.run();
    expect(blacklist.isBlocked(c, lib().blacklist)).toBe(false);
    expect(lib().likes).toEqual([c.id]);
  });

  it('играющий трек — плеер переходит к следующему; та же песня из другого источника в очереди тоже уходит', () => {
    const a = track('a', 'madk1d', 'Цена');
    const copy: Track = { ...track('x', 'MADK1D', 'Цена (Official Audio)'), id: 'youtube:x', source: 'youtube' };
    const b = track('b');
    p().playList([a, b, copy], 0);
    actions.dislikeTrack(a);
    expect(p().queue[p().index].id).toBe(b.id);
    expect(ids(p().queue)).toEqual([a.id, b.id]);

    actions.restoreTrack(a.id);
    expect(lib().blacklist.tracks).toEqual([]);
  });
});

describe('blockArtistEverywhere / restoreArtist', () => {
  it('исполнитель в чёрном списке: подписка снята, его треки (и фиты) уходят из будущей очереди, тост с «Вернуть»', () => {
    library.useLibrary.getState().follow({ id: '7', name: 'Bad' });
    const [a, b, c, d] = [track('a'), track('b', 'Bad'), track('c', 'Other', 'Song (feat. Bad)'), track('d')];
    p().playList([a, b, c, d], 0);

    actions.blockArtistEverywhere({ name: 'Bad', id: '7' });
    expect(lib().followedArtists).toEqual([]);
    expect(blacklist.isArtistBlocked('bad', lib().blacklist)).toBe(true);
    expect(ids(p().queue)).toEqual([a.id, d.id]);
    expect(lastToast().text).toBe('Больше не будешь слышать Bad в волнах и подборках');
    expect(lastToast().action?.label).toBe('Вернуть');

    lastToast().action!.run();
    expect(lib().blacklist.artists).toEqual([]);
    expect(lib().followedArtists.map((f) => f.id)).toEqual(['7']);

    actions.blockArtistEverywhere({ name: 'Bad' });
    actions.restoreArtist('bad');
    expect(lib().blacklist.artists).toEqual([]);
  });
});
