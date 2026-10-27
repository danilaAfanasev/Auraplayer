import { describe, expect, it } from 'vitest';
import { matchesArtistQuery, ownArtistsOf, rankArtistCards, MIN_FANS } from './artistSearch';
import { blockArtist } from './blacklist';
import { emptyLibrary } from './library';
import type { LibraryData, Track } from './types';

const names = (cards: { name: string }[]) => cards.map((c) => c.name);

describe('совпадение имени с запросом', () => {
  it('имя или слово в нём начинается с запроса; нечёткое совпадение — нет', () => {
    expect(matchesArtistQuery('villian', 'villi')).toBe(true);
    expect(matchesArtistQuery('Billie Eilish', 'villi')).toBe(false);
    expect(matchesArtistQuery('Kanye West', 'west')).toBe(true);
    expect(matchesArtistQuery('Juice', 'juice wrld')).toBe(false);
    expect(matchesArtistQuery('Juice WRLD', 'juice wrld')).toBe(true);
    expect(matchesArtistQuery('madk1d', 'MAD')).toBe(true);
    expect(matchesArtistQuery('Nomad', 'mad')).toBe(false);
  });
});

describe('порядок карточек артистов', () => {
  it('kanye: самый популярный первым, тёзка с сотней фанатов — после, ноль фанатов — вниз', () => {
    const cards = rankArtistCards({
      query: 'kanye',
      own: [],
      catalog: [
        { id: '111', name: 'Kanye' },
        { id: '2715720', name: 'Kanye West' },
      ],
      popular: [
        { name: 'Kanye Junk', fans: 0 },
        { name: 'Kanye West', fans: 4_500_000 },
        { name: 'Kanye', fans: 121 },
      ],
    });
    expect(names(cards)).toEqual(['Kanye West', 'Kanye', 'Kanye Junk']);
    expect(cards[0].id).toBe('2715720');
  });

  it('mad: свой madk1d первым, хотя поиск его не дал; дальше по фанатам', () => {
    const cards = rankArtistCards({
      query: 'mad',
      own: [
        { name: 'madk1d', id: '1598190372', score: 1000 },
        { name: 'SALUKI', score: 900 }, // не подходит под запрос
      ],
      catalog: [{ id: '5', name: 'MAD' }],
      popular: [
        { name: 'MAD', fans: 900 },
        { name: 'Madonna', fans: 3_000_000 },
        { name: 'M.A.D', fans: 50 },
      ],
    });
    expect(names(cards)).toEqual(['madk1d', 'Madonna', 'MAD']);
  });

  it('villi: Billie Eilish из нечёткого поиска не попадает', () => {
    const cards = rankArtistCards({
      query: 'villi',
      own: [],
      catalog: [],
      popular: [
        { name: 'Billie Eilish', fans: 9_000_000 },
        { name: 'villian', fans: 343 },
        { name: 'Villi Beats', fans: 2 },
      ],
    });
    expect(names(cards)).toEqual(['villian', 'Villi Beats']);
  });

  it('один артист в каталоге и в открытом API — одна карточка (регистр и знаки не важны), свой — не повторяется ниже', () => {
    const cards = rankArtistCards({
      query: 'saluki',
      own: [{ name: 'SALUKI', score: 5 }],
      catalog: [
        { id: '1', name: 'SALUKI' },
        { id: '2', name: 'Felipe Saluki' },
      ],
      popular: [
        { name: 'Saluki', fans: 800_000, imageUrl: 'https://img.example/s.jpg' },
        { name: 'saluki', fans: 3 },
      ],
    });
    expect(names(cards)).toEqual(['SALUKI', 'Felipe Saluki']);
    expect(cards[0]).toEqual({ name: 'SALUKI', id: '1', imageUrl: 'https://img.example/s.jpg' });
  });

  it('подписи сборников и чужие дуэты не попадают («made famous by … feat Kanye West»), свой дуэт — остаётся', () => {
    const cards = rankArtistCards({
      query: 'kanye',
      own: [],
      catalog: [{ id: '2715720', name: 'Kanye West' }],
      popular: [
        { name: 'Kanye West', fans: 4_500_000 },
        { name: 'Made famous by Katy Perry feat Kanye West', fans: 9000 },
        { name: 'Pusha T, Big Sean, Kanye West, Common & CyHi Da Prynce', fans: 5000 },
        { name: 'Jamie Foxx featuring Kanye West & The-Dream', fans: 4000 },
        { name: 'Kanye', fans: 121 },
      ],
    });
    expect(names(cards)).toEqual(['Kanye West', 'Kanye']);
    const duo = rankArtistCards({ query: 'simon', own: [], catalog: [], popular: [{ name: 'Simon & Garfunkel', fans: 2_000_000 }] });
    expect(names(duo)).toEqual(['Simon & Garfunkel']);
  });

  it('id без каталога — из кэша по имени; не больше восьми карточек', () => {
    const popular = Array.from({ length: 12 }, (_, i) => ({ name: `Mad ${i}`, fans: MIN_FANS + i }));
    const cards = rankArtistCards({ query: 'mad', own: [], catalog: [], popular, knownIds: new Map([['mad 11', '77']]) });
    expect(cards).toHaveLength(8);
    expect(cards[0]).toEqual({ name: 'Mad 11', id: '77' });
  });
});

describe('свои артисты из библиотеки', () => {
  const track = (id: string, artist: string): Track => ({ id: `archive:${id}`, source: 'archive', sourceId: id, title: `Песня ${id}`, artist, downloadable: true });

  it('подписки — выше всех, затем лайки и история; скрытые исполнители — нет', () => {
    const a = track('a', 'madk1d & Kai Angel');
    const b = track('b', 'OG Buda');
    const c = track('c', 'Плохой');
    const lib: LibraryData = {
      ...emptyLibrary(),
      tracks: { [a.id]: a, [b.id]: b, [c.id]: c },
      likes: [b.id, c.id],
      history: [{ trackId: a.id, playedAt: 1 }],
      followedArtists: [{ id: '1659366660', name: 'Heronwater', followedAt: 1 }],
      blacklist: blockArtist(emptyLibrary().blacklist, { name: 'Плохой' }, 1),
    };
    const own = ownArtistsOf(lib, 10);
    expect(own.map((o) => o.name)).toEqual(['Heronwater', 'OG Buda', 'madk1d', 'Kai Angel']);
    expect(own[0].id).toBe('1659366660');
  });
});
