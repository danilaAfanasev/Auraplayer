import { describe, expect, it } from 'vitest';
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  emptyLibrary,
  followArtist,
  followArtists,
  isFollowing,
  isLiked,
  isRetiredTrack,
  movePlaylistTrack,
  normalizeLibrary,
  pushHistory,
  removeFromPlaylist,
  reorderTarget,
  renamePlaylist,
  toggleLike,
  unfollowArtist,
  blockArtist,
  blockTrack,
  recordGenre,
  recordTaste,
  setTasteGenres,
  unblockArtist,
  unblockTrack,
} from './library';
import { isBlocked } from './blacklist';
import { SOURCE_IDS, type LibraryData, type Track } from './types';

const track = (n: number, source: Track['source'] = 'archive'): Track => ({
  id: `${source}:t${n}`,
  source,
  sourceId: `t${n}`,
  title: `Трек ${n}`,
  artist: `Артист ${n}`,
  downloadable: true,
});

function withPlaylist(): { lib: LibraryData; id: string } {
  const { lib, playlist } = createPlaylist(emptyLibrary(), 'Вечер', { id: 'p1', now: 1000 });
  return { lib, id: playlist.id };
}

describe('emptyLibrary', () => {
  it('пустая библиотека версии 1', () => {
    expect(emptyLibrary()).toEqual({
      version: 1,
      tracks: {},
      playlists: [],
      likes: [],
      history: [],
      followedArtists: [],
      blacklist: { tracks: [], artists: [] },
      taste: { events: [], genres: [] },
    });
  });
});

describe('плейлисты', () => {
  it('createPlaylist добавляет плейлист и не меняет исходный объект', () => {
    const before = emptyLibrary();
    const { lib, playlist } = createPlaylist(before, '  Вечер  ', { id: 'p1', now: 1000 });
    expect(playlist).toEqual({ id: 'p1', name: 'Вечер', trackIds: [], createdAt: 1000, updatedAt: 1000 });
    expect(lib.playlists).toEqual([playlist]);
    expect(before.playlists).toEqual([]);
  });
  it('createPlaylist без id генерирует уникальный id, пустое имя — «Новый плейлист»', () => {
    const a = createPlaylist(emptyLibrary(), '');
    const b = createPlaylist(a.lib, 'Второй');
    expect(a.playlist.name).toBe('Новый плейлист');
    expect(a.playlist.id).toMatch(/^[\w-]{10,}$/);
    expect(a.playlist.id).not.toBe(b.playlist.id);
  });
  it('renamePlaylist меняет имя и updatedAt', () => {
    const { lib, id } = withPlaylist();
    const next = renamePlaylist(lib, id, 'Утро', 2000);
    expect(next.playlists[0]).toMatchObject({ name: 'Утро', updatedAt: 2000, createdAt: 1000 });
    expect(lib.playlists[0].name).toBe('Вечер');
  });
  it('deletePlaylist убирает плейлист и неиспользуемые снимки треков', () => {
    const { lib, id } = withPlaylist();
    const added = addToPlaylist(lib, id, track(1)).lib;
    const liked = toggleLike(added, track(2));
    const next = deletePlaylist(liked, id);
    expect(next.playlists).toEqual([]);
    expect(Object.keys(next.tracks)).toEqual(['archive:t2']);
  });
});

describe('addToPlaylist', () => {
  it('добавляет трек в конец и кладёт снимок в lib.tracks', () => {
    const { lib, id } = withPlaylist();
    const r1 = addToPlaylist(lib, id, track(1), 5);
    const r2 = addToPlaylist(r1.lib, id, track(2, 'youtube'), 6);
    expect(r1.added).toBe(true);
    expect(r2.lib.playlists[0].trackIds).toEqual(['archive:t1', 'youtube:t2']);
    expect(r2.lib.playlists[0].updatedAt).toBe(6);
    expect(r2.lib.tracks['youtube:t2'].title).toBe('Трек 2');
    expect(lib.playlists[0].trackIds).toEqual([]);
  });
  it('повторное добавление — added: false, без дубля', () => {
    const { lib, id } = withPlaylist();
    const r1 = addToPlaylist(lib, id, track(1));
    const r2 = addToPlaylist(r1.lib, id, track(1));
    expect(r2.added).toBe(false);
    expect(r2.lib.playlists[0].trackIds).toEqual(['archive:t1']);
  });
  it('несуществующий плейлист — added: false', () => {
    const r = addToPlaylist(emptyLibrary(), 'nope', track(1));
    expect(r.added).toBe(false);
    expect(r.lib.tracks).toEqual({});
  });
});

describe('removeFromPlaylist / movePlaylistTrack', () => {
  const filled = () => {
    const { lib, id } = withPlaylist();
    let l = lib;
    for (const n of [1, 2, 3, 4]) l = addToPlaylist(l, id, track(n)).lib;
    return { lib: l, id };
  };
  it('removeFromPlaylist убирает трек; снимок остаётся, пока трек где-то упомянут', () => {
    const { lib, id } = filled();
    const liked = toggleLike(lib, track(2));
    const next = removeFromPlaylist(removeFromPlaylist(liked, id, 'archive:t2'), id, 'archive:t3');
    expect(next.playlists[0].trackIds).toEqual(['archive:t1', 'archive:t4']);
    expect(next.tracks['archive:t2']).toBeDefined();
    expect(next.tracks['archive:t3']).toBeUndefined();
  });
  it('movePlaylistTrack переставляет трек', () => {
    const { lib, id } = filled();
    expect(movePlaylistTrack(lib, id, 0, 2).playlists[0].trackIds).toEqual([
      'archive:t2', 'archive:t3', 'archive:t1', 'archive:t4',
    ]);
    expect(movePlaylistTrack(lib, id, 3, 0).playlists[0].trackIds).toEqual([
      'archive:t4', 'archive:t1', 'archive:t2', 'archive:t3',
    ]);
  });
  it('movePlaylistTrack вне диапазона — без изменений', () => {
    const { lib, id } = filled();
    expect(movePlaylistTrack(lib, id, 0, 9).playlists[0].trackIds).toEqual(lib.playlists[0].trackIds);
    expect(movePlaylistTrack(lib, id, -1, 1).playlists[0].trackIds).toEqual(lib.playlists[0].trackIds);
  });
});

describe('toggleLike', () => {
  it('новые лайки — в начало; повторный вызов снимает', () => {
    const l1 = toggleLike(emptyLibrary(), track(1));
    const l2 = toggleLike(l1, track(2));
    expect(l2.likes).toEqual(['archive:t2', 'archive:t1']);
    expect(isLiked(l2, 'archive:t1')).toBe(true);
    const l3 = toggleLike(l2, track(1));
    expect(l3.likes).toEqual(['archive:t2']);
    expect(isLiked(l3, 'archive:t1')).toBe(false);
    expect(l3.tracks['archive:t1']).toBeUndefined();
  });
});

describe('pushHistory', () => {
  it('новые — в начало, повтор того же трека поднимается наверх', () => {
    let l = pushHistory(emptyLibrary(), track(1), 100);
    l = pushHistory(l, track(2), 200);
    l = pushHistory(l, track(1), 300);
    expect(l.history).toEqual([
      { trackId: 'archive:t1', playedAt: 300 },
      { trackId: 'archive:t2', playedAt: 200 },
    ]);
    expect(l.tracks['archive:t2']).toBeDefined();
  });
  it('хранится не больше 100 записей', () => {
    let l = emptyLibrary();
    for (let i = 0; i < 130; i++) l = pushHistory(l, track(i), i);
    expect(l.history).toHaveLength(100);
    expect(l.history[0].trackId).toBe('archive:t129');
    expect(l.tracks['archive:t0']).toBeUndefined();
    expect(Object.keys(l.tracks)).toHaveLength(100);
  });
});

describe('normalizeLibrary', () => {
  it('мусор → пустая библиотека', () => {
    expect(normalizeLibrary(null)).toEqual(emptyLibrary());
    expect(normalizeLibrary('x')).toEqual(emptyLibrary());
    expect(normalizeLibrary({ version: 1, playlists: 'oops' })).toEqual(emptyLibrary());
  });
  it('корректные данные проходят без потерь, битые записи отбрасываются', () => {
    const { lib, id } = withPlaylist();
    const good = toggleLike(addToPlaylist(lib, id, track(1)).lib, track(2));
    const raw = JSON.parse(JSON.stringify(good));
    raw.playlists.push({ id: 5 });
    raw.likes.push(42);
    expect(normalizeLibrary(raw)).toEqual(good);
  });
});

describe('reorderTarget (перетаскивание строк плейлиста)', () => {
  const apply = (items: string[], from: number, to: number | null): string[] => {
    if (to === null) return items;
    const copy = [...items];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
  };
  const abcde = ['a', 'b', 'c', 'd', 'e'];

  it('строка вниз, «перед» целевой: встаёт перед ней', () => {
    expect(apply(abcde, 0, reorderTarget(0, 3, false)).join('')).toBe('bcade');
  });
  it('строка вниз, «после» целевой: встаёт после неё', () => {
    expect(apply(abcde, 0, reorderTarget(0, 3, true)).join('')).toBe('bcdae');
  });
  it('строка вверх, «перед» целевой', () => {
    expect(apply(abcde, 4, reorderTarget(4, 1, false)).join('')).toBe('aebcd');
  });
  it('строка вверх, «после» целевой', () => {
    expect(apply(abcde, 4, reorderTarget(4, 1, true)).join('')).toBe('abecd');
  });
  it('на месте — null: перед следующей, после предыдущей, на себя', () => {
    expect(reorderTarget(2, 3, false)).toBeNull();
    expect(reorderTarget(2, 1, true)).toBeNull();
    expect(reorderTarget(2, 2, false)).toBeNull();
    expect(reorderTarget(2, 2, true)).toBeNull();
  });
});

describe("подписки на артистов", () => {
  const madk1d = { id: "1598190372", name: "madk1d", imageUrl: "https://img.example/m.jpg" };
  const saluki = { id: "1427819350", name: "SALUKI" };

  it("followArtist кладёт артиста в начало с временем подписки, повтор ничего не меняет", () => {
    const a = followArtist(emptyLibrary(), madk1d, 1000);
    const b = followArtist(a, saluki, 2000);
    expect(b.followedArtists).toEqual([
      { id: "1427819350", name: "SALUKI", followedAt: 2000 },
      { id: "1598190372", name: "madk1d", imageUrl: "https://img.example/m.jpg", followedAt: 1000 },
    ]);
    expect(followArtist(b, madk1d, 3000)).toBe(b);
    expect(isFollowing(b, "1598190372")).toBe(true);
    expect(isFollowing(emptyLibrary(), "1598190372")).toBe(false);
  });

  it("unfollowArtist убирает подписку и не трогает остальные", () => {
    const lib = followArtists(emptyLibrary(), [madk1d, saluki], 1000);
    const next = unfollowArtist(lib, "1598190372");
    expect(next.followedArtists.map((a) => a.name)).toEqual(["SALUKI"]);
    expect(unfollowArtist(next, "нет такого")).toBe(next);
  });

  it("followArtists подписывает на всех сразу, порядок — как в списке, уже подписанные не дублируются", () => {
    const lib = followArtist(emptyLibrary(), saluki, 500);
    const next = followArtists(lib, [madk1d, saluki], 1000);
    expect(next.followedArtists.map((a) => a.name)).toEqual(["madk1d", "SALUKI"]);
  });

  it("normalizeLibrary: старый library.json без поля — пустые подписки; битые записи отброшены, подписки переживают перезапуск", () => {
    expect(normalizeLibrary({ version: 1, tracks: {}, playlists: [], likes: [], history: [] }).followedArtists).toEqual([]);
    const saved = followArtists(emptyLibrary(), [madk1d, saluki], 1000);
    const raw = JSON.parse(JSON.stringify(saved));
    raw.followedArtists.push({ id: "", name: "пусто" }, { name: "без id" }, "мусор", { ...raw.followedArtists[0] });
    raw.followedArtists.push({ id: "1", name: "Плохая картинка", imageUrl: "javascript:alert(1)", followedAt: 5 });
    expect(normalizeLibrary(raw).followedArtists).toEqual([
      ...saved.followedArtists,
      { id: "1", name: "Плохая картинка", followedAt: 5 },
    ]);
  });
});

describe('normalizeLibrary: треки убранного источника (Jamendo)', () => {
  // library.json прошлой версии: трек Jamendo в лайках, плейлисте и истории.
  const jamendo = {
    id: 'jamendo:1886257',
    source: 'jamendo',
    sourceId: '1886257',
    title: 'Ночной город',
    artist: 'Автор',
    downloadable: true,
    pageUrl: 'https://www.jamendo.com/track/1886257',
  };
  const old = {
    version: 1,
    tracks: { 'jamendo:1886257': jamendo },
    playlists: [{ id: 'p1', name: 'Вечер', trackIds: ['jamendo:1886257'], createdAt: 1, updatedAt: 2 }],
    likes: ['jamendo:1886257'],
    history: [{ trackId: 'jamendo:1886257', playedAt: 3 }],
    followedArtists: [],
  };

  it('трек остаётся в библиотеке, лайках, плейлисте и истории под прежним id', () => {
    const lib = normalizeLibrary(old);
    expect(Object.keys(lib.tracks)).toEqual(['jamendo:1886257']);
    expect(lib.likes).toEqual(['jamendo:1886257']);
    expect(lib.playlists[0].trackIds).toEqual(['jamendo:1886257']);
    expect(lib.history).toEqual([{ trackId: 'jamendo:1886257', playedAt: 3 }]);
    expect(lib.tracks['jamendo:1886257']).toMatchObject({ title: 'Ночной город', artist: 'Автор' });
  });

  it('источник трека — известный приложению (метка не ломается), сам трек помечен убранным и не скачивается; повторная загрузка ничего не теряет', () => {
    const lib = normalizeLibrary(old);
    const t = lib.tracks['jamendo:1886257'];
    expect(SOURCE_IDS).toContain(t.source);
    expect(t.downloadable).toBe(false);
    expect(isRetiredTrack(t)).toBe(true);
    expect(normalizeLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
  });

  it('isRetiredTrack: обычные треки — нет', () => {
    expect(isRetiredTrack({ id: 'archive:x/y.mp3' })).toBe(false);
    expect(isRetiredTrack({ id: 'local:C:\Музыка\a.mp3' })).toBe(false);
    expect(isRetiredTrack({ id: 'jamendo:1' })).toBe(true);
  });
});

describe('чёрный список и вкус в библиотеке', () => {
  it('старый library.json без новых полей читается: пустой чёрный список и вкус', () => {
    const lib = normalizeLibrary({ version: 1, tracks: {}, playlists: [], likes: [], history: [], followedArtists: [] });
    expect(lib.blacklist).toEqual({ tracks: [], artists: [] });
    expect(lib.taste).toEqual({ events: [], genres: [] });
  });

  it('скрытие трека снимает лайк; снимок скрытого трека не вычищается и переживает normalizeLibrary', () => {
    const a = track(1);
    let lib = toggleLike(emptyLibrary(), a);
    lib = blockTrack(lib, a, 50);
    expect(lib.likes).toEqual([]);
    expect(lib.blacklist.tracks.map((b) => b.track)).toEqual([a]);
    // pushHistory и toggleLike чистят снимки lib.tracks — снимок в чёрном списке остаётся
    lib = toggleLike(pushHistory(lib, track(2), 60), track(2));
    expect(lib.blacklist.tracks.map((b) => b.track.id)).toEqual([a.id]);
    const reread = normalizeLibrary(JSON.parse(JSON.stringify(lib)));
    expect(reread.blacklist).toEqual(lib.blacklist);
    expect(isBlocked(a, reread.blacklist)).toBe(true);
    expect(unblockTrack(reread, a.id).blacklist.tracks).toEqual([]);
  });

  it('скрытие исполнителя снимает подписку на него и пишет «Не нравится» во вкус', () => {
    let lib = followArtist(emptyLibrary(), { id: '7', name: 'Bad' }, 1);
    lib = followArtist(lib, { id: '8', name: 'Good' }, 1);
    lib = blockArtist(lib, { name: 'Bad', id: '7' }, 100);
    expect(lib.followedArtists.map((a) => a.id)).toEqual(['8']);
    expect(lib.blacklist.artists.map((a) => a.key)).toEqual(['bad']);
    expect(lib.taste.events).toEqual([{ artist: 'Bad', kind: 'dislike', at: 100 }]);
    const reread = normalizeLibrary(JSON.parse(JSON.stringify(lib)));
    expect(reread.blacklist.artists).toEqual(lib.blacklist.artists);
    expect(reread.taste).toEqual(lib.taste);
    expect(unblockArtist(reread, 'bad').blacklist.artists).toEqual([]);
  });

  it('вкус: события дописываются, жанры — последние первыми, не больше 8', () => {
    let lib = recordTaste(emptyLibrary(), [{ artist: 'A', kind: 'like', at: 1 }]);
    expect(lib.taste.events).toEqual([{ artist: 'A', kind: 'like', at: 1 }]);
    lib = setTasteGenres(lib, ['rock', 'pop', 'rock']);
    expect(lib.taste.genres).toEqual(['rock', 'pop']);
    lib = recordGenre(lib, 'pop');
    expect(lib.taste.genres).toEqual(['pop', 'rock']);
    for (const g of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) lib = recordGenre(lib, g);
    expect(lib.taste.genres).toEqual(['g', 'f', 'e', 'd', 'c', 'b', 'a', 'pop']);
    expect(normalizeLibrary(JSON.parse(JSON.stringify(lib))).taste).toEqual(lib.taste);
  });
});
