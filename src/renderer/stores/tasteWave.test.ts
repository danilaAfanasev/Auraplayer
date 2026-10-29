import { describe, expect, it } from 'vitest';
import { GENRES } from '../../shared/genres';
import { blockArtist, blockTrack, emptyLibrary, followArtist, pushHistory, recordTaste, setTasteGenres, toggleLike } from '../../shared/library';
import type { TasteEventKind } from '../../shared/taste';
import type { LibraryData, Track } from '../../shared/types';
import { myWaveSeed, tasteChips } from './tasteWave';

const NOW = Date.UTC(2026, 9, 27, 12);
const DAY = 86_400_000;

const track = (id: string, artist: string, title = `Песня ${id}`): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title,
  artist,
  downloadable: true,
});

/** `times` событий `kind` исполнителю `artist`, по одному в минуту до `at`. */
function listen(lib: LibraryData, artist: string, times: number, kind: TasteEventKind = 'complete', at = NOW - 60_000): LibraryData {
  return recordTaste(
    lib,
    Array.from({ length: times }, (_, i) => ({ artist, kind, at: at - i * 60_000 })),
  );
}

const chipTitles = (lib: LibraryData, now = NOW) => tasteChips(lib, now).map((c) => c.title);

describe('«Моя волна» из вкуса', () => {
  it('артисты — по рейтингу, сначала самые любимые, скрытые исполнители не попадают', () => {
    let lib = emptyLibrary();
    lib = listen(lib, 'Alpha', 6); // 6
    lib = listen(lib, 'Beta', 1, 'onboard'); // 4
    lib = listen(lib, 'Gamma', 2); // 2
    lib = listen(lib, 'Hidden', 20); // 20, но скрыт
    lib = listen(lib, 'Skipped', 4, 'skip'); // отрицательный — не вкус
    lib = blockArtist(lib, { name: 'Hidden' }, NOW);
    const seed = myWaveSeed(lib, NOW);
    expect(seed.title).toBe('Моя волна');
    expect(seed.artists?.slice(0, 3)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(seed.artists).not.toContain('Hidden');
    expect(seed.artists).not.toContain('Skipped');
  });

  it('не больше 12 артистов; старое остывает и уступает свежему', () => {
    let lib = emptyLibrary();
    for (let i = 0; i < 15; i++) lib = listen(lib, `Artist ${i}`, 1);
    // Много, но два месяца назад: 10 × 2^-4 ≈ 0,6 — ниже свежего одного прослушивания.
    lib = listen(lib, 'Old', 10, 'complete', NOW - 60 * DAY);
    const seed = myWaveSeed(lib, NOW);
    expect(seed.artists).toHaveLength(12);
    expect(seed.artists).not.toContain('Old');
  });

  it('стартовые треки — лайки и недавние, без скрытых треков и треков скрытых исполнителей', () => {
    let lib = listen(emptyLibrary(), 'Alpha', 3);
    lib = toggleLike(lib, track('l1', 'Alpha'));
    lib = pushHistory(lib, track('h1', 'Beta'), NOW - 1000);
    lib = pushHistory(lib, track('h2', 'Hidden'), NOW - 2000);
    lib = pushHistory(lib, track('h3', 'Beta'), NOW - 3000);
    lib = blockTrack(lib, track('h3', 'Beta'), NOW);
    lib = blockArtist(lib, { name: 'Hidden' }, NOW);
    const ids = myWaveSeed(lib, NOW).tracks?.map((t) => t.id);
    expect(ids).toEqual(['youtube:l1', 'youtube:h1']);
  });

  it('жанры вкуса — дополнительные запросы', () => {
    let lib = listen(emptyLibrary(), 'Alpha', 3);
    lib = setTasteGenres(lib, ['hiphop', 'rock']);
    const queries = myWaveSeed(lib, NOW).queries ?? [];
    expect(queries.some((q) => q.includes('рэп') || q.includes('hip hop'))).toBe(true);
    expect(queries.some((q) => q.includes('рок') || q.includes('rock'))).toBe(true);
  });

  it('жанр вкуса ищется и по-английски — в волну попадает и зарубежное похожее', () => {
    let lib = listen(emptyLibrary(), 'Alpha', 3);
    lib = setTasteGenres(lib, ['emorap']);
    const queries = myWaveSeed(lib, NOW).queries ?? [];
    expect(queries).toEqual(expect.arrayContaining(['эмо рэп 2026', 'emo rap 2026']));
  });

  it('нейтральная волна и чипы без вкуса — из популярных жанров', () => {
    const chips = tasteChips(emptyLibrary(), NOW).map((c) => c.genre);
    expect(chips).toEqual(['pop', 'hiphop', 'electronic', 'rock', 'indie']);
  });

  it('старая библиотека без журнала вкуса — подписки и исполнители лайков, как раньше', () => {
    let lib = followArtist(emptyLibrary(), { id: '1', name: 'Followed' }, NOW);
    lib = { ...lib, taste: { events: [], genres: [] } };
    lib = toggleLike(lib, track('l1', 'Liked Artist'));
    expect(myWaveSeed(lib, NOW).artists).toEqual(['Followed', 'Liked Artist']);
  });

  it('нет ни вкуса, ни жанров — нейтральная волна: популярное и жанры, без артистов', () => {
    const chart = [track('c1', 'Chart One'), track('c2', 'Chart Two'), track('c3', 'Hidden')];
    const lib = blockArtist(emptyLibrary(), { name: 'Hidden' }, NOW);
    const seed = myWaveSeed(lib, NOW, chart);
    expect(seed.title).toBe('Моя волна');
    expect(seed.artists ?? []).toEqual([]);
    expect((seed.queries ?? []).length).toBeGreaterThan(0);
    expect(seed.extra?.map((t) => t.id)).toEqual(['youtube:c1', 'youtube:c2']);
    // Без чарта (нет сети) — только жанры.
    const offline = myWaveSeed(emptyLibrary(), NOW);
    expect(offline.artists ?? []).toEqual([]);
    expect((offline.queries ?? []).length).toBeGreaterThan(0);
  });

  it('после первого запуска: выбранные артисты и жанр — сид волны', () => {
    let lib = recordTaste(emptyLibrary(), [
      { artist: 'First Pick', kind: 'onboard', at: NOW },
      { artist: 'Second Pick', kind: 'onboard', at: NOW },
    ]);
    lib = setTasteGenres(lib, ['pop']);
    const seed = myWaveSeed(lib, NOW);
    expect([...(seed.artists ?? [])].sort()).toEqual(['First Pick', 'Second Pick']);
    expect((seed.queries ?? []).some((q) => q.includes('поп') || q.includes('pop'))).toBe(true);
  });
});

describe('чипы волн из вкуса', () => {
  it('3–4 «Волна по <артист>» по рейтингу и 1–2 жанра пользователя', () => {
    let lib = emptyLibrary();
    lib = listen(lib, 'Alpha', 8);
    lib = listen(lib, 'Beta', 6);
    lib = listen(lib, 'Gamma', 4);
    lib = listen(lib, 'Delta', 3);
    lib = listen(lib, 'Epsilon', 2);
    lib = setTasteGenres(lib, ['hiphop', 'rock', 'jazz']);
    const chips = tasteChips(lib, NOW);
    const artists = chips.filter((c) => !c.genre);
    const genres = chips.filter((c) => c.genre);
    expect(artists.map((c) => c.title)).toEqual(['Волна по Alpha', 'Волна по Beta', 'Волна по Gamma', 'Волна по Delta']);
    expect(genres.map((c) => c.genre)).toEqual(['hiphop', 'rock']);
    // Заголовок волны стабилен (по нему кнопка показывает «играет»): имя артиста, название жанра.
    expect(artists[0].seed).toMatchObject({ title: 'Alpha', artists: ['Alpha'] });
    expect(genres[0].seed.title).toBe('Хип-хоп');
    expect(new Set(chips.map((c) => c.id)).size).toBe(chips.length);
  });

  it('пользователь много слушает нового артиста — его чип появляется, скрытый исчезает', () => {
    let lib = emptyLibrary();
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) lib = listen(lib, name, 3, 'complete', NOW - 3 * DAY);
    expect(chipTitles(lib)).not.toContain('Волна по Newcomer');
    lib = listen(lib, 'Newcomer', 10, 'complete', NOW);
    expect(chipTitles(lib)[0]).toBe('Волна по Newcomer');
    lib = blockArtist(lib, { name: 'Newcomer' }, NOW);
    expect(chipTitles(lib)).not.toContain('Волна по Newcomer');
  });

  it('нет вкуса — 5 нейтральных жанровых чипов из списка жанров', () => {
    const chips = tasteChips(emptyLibrary(), NOW);
    expect(chips).toHaveLength(5);
    const tags = GENRES.map((g) => g.tag);
    for (const c of chips) {
      expect(c.genre && tags.includes(c.genre)).toBe(true);
      expect(c.seed.artists ?? []).toEqual([]);
    }
  });

  it('дуэт: события на части («A», «B») и подписка на «A & B» — один чип, без несуществующих «артистов»', () => {
    let lib = followArtist(emptyLibrary(), { id: '7', name: 'Duo A & Duo B' }, NOW);
    lib = listen(lib, 'Duo A', 5);
    lib = listen(lib, 'Duo B', 5);
    lib = listen(lib, 'Duo A & Duo B', 1, 'follow');
    lib = listen(lib, 'Solo', 3);
    const titles = chipTitles(lib).filter((t) => t.startsWith('Волна по'));
    expect(titles).toEqual(['Волна по Duo A & Duo B', 'Волна по Solo']);
    expect(myWaveSeed(lib, NOW).artists).toEqual(['Duo A & Duo B', 'Solo']);
  });
});
