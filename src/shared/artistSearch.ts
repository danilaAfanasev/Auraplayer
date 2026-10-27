// Карточки артистов в поиске: свои артисты (подписки, вкус, лайки, история) первыми, затем по популярности (число
// фанатов из открытого API), остальные — ниже. Совпадение — имя или слово в нём начинается с запроса: «mad» → madk1d,
// «villi» → villian, но не нечёткое «Billie Eilish». Чистые функции без electron и DOM.
import { artistKey, splitArtists } from './artistNames';
import { isArtistBlocked } from './blacklist';
import { artistScores } from './taste';
import type { ArtistCard, LibraryData } from './types';

/** Столько карточек артистов показывает поиск. */
export const ARTIST_CARDS = 8;
/** Меньше стольких фанатов — «никто»: такие артисты идут вниз, после известных. */
export const MIN_FANS = 10;

/** Свой артист: имя, id каталога, если известен (подписка), и вес — чем больше, тем выше. */
export interface OwnArtist {
  name: string;
  id?: string;
  imageUrl?: string;
  score: number;
}

/** Найденный в каталоге (в его порядке). */
export interface FoundCatalogArtist {
  id: string;
  name: string;
}

/** Найденный в открытом API артистов: фанаты и фото. */
export interface FoundPopularArtist {
  name: string;
  fans: number;
  imageUrl?: string;
}

/** Имя или слово в нём начинается с запроса (регистр и знаки не важны). */
export function matchesArtistQuery(name: string, query: string): boolean {
  const n = artistKey(name);
  const q = artistKey(query);
  if (!n || !q) return false;
  return n.startsWith(q) || n.includes(` ${q}`);
}

/** «Made famous by … feat Kanye West», «… Karaoke», «Tribute to …» — не артисты, а подписи сборников. */
const NOT_AN_ARTIST = / (feat|featuring|ft|made famous|karaoke|tribute|in the style of|originally performed) /;

/**
 * Карточка годится: имя подходит под запрос, это не подпись сборника и не чужой дуэт, где запрос — лишь второй
 * участник («Pusha T, Big Sean, Kanye West…» на «kanye»; «Simon & Garfunkel» на «simon» остаётся).
 */
export function isArtistCandidate(name: string, query: string): boolean {
  if (!matchesArtistQuery(name, query)) return false;
  const key = ` ${artistKey(name)} `;
  if (NOT_AN_ARTIST.test(key)) return false;
  return splitArtists(name).length <= 1 || artistKey(name).startsWith(artistKey(query));
}

const FOLLOW_SCORE = 1000;
const LIKE_SCORE = 3;
const PLAY_SCORE = 1;

/** Свои артисты из библиотеки: подписки, вкус, исполнители лайков и истории; без чёрного списка. */
export function ownArtistsOf(lib: LibraryData, now: number): OwnArtist[] {
  const byKey = new Map<string, OwnArtist>();
  const add = (name: string, score: number, extra: Partial<OwnArtist> = {}) => {
    const key = artistKey(name);
    if (!key || isArtistBlocked(name, lib.blacklist)) return;
    const prev = byKey.get(key);
    if (prev) {
      prev.score += score;
      if (!prev.id && extra.id) prev.id = extra.id;
      if (!prev.imageUrl && extra.imageUrl) prev.imageUrl = extra.imageUrl;
    } else byKey.set(key, { name: name.trim(), score, ...extra });
  };
  for (const a of lib.followedArtists) add(a.name, FOLLOW_SCORE, { id: a.id, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) });
  for (const s of artistScores(lib.taste, now, lib.blacklist)) add(s.name, s.score);
  const fromTracks = (ids: readonly string[], score: number) => {
    for (const id of ids) {
      const t = lib.tracks[id];
      if (t) for (const name of splitArtists(t.artist, t.title)) add(name, score);
    }
  };
  fromTracks(lib.likes, LIKE_SCORE);
  fromTracks(
    lib.history.map((h) => h.trackId),
    PLAY_SCORE,
  );
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

export interface RankInput {
  query: string;
  own: readonly OwnArtist[];
  catalog: readonly FoundCatalogArtist[];
  popular: readonly FoundPopularArtist[];
  /** id каталога, уже известные по имени (кэш): карточка без id откроется сразу. */
  knownIds?: ReadonlyMap<string, string>;
  max?: number;
}

/**
 * Порядок: свои (по весу) → известные (по числу фанатов) → остальные (каталог в его порядке, затем малоизвестные).
 * Каталог и открытый API склеиваются по `artistKey`: один артист — одна карточка.
 */
export function rankArtistCards({ query, own, catalog, popular, knownIds, max = ARTIST_CARDS }: RankInput): ArtistCard[] {
  interface Entry {
    key: string;
    name: string;
    id?: string;
    imageUrl?: string;
    fans?: number;
    catalogRank?: number;
  }
  const entries = new Map<string, Entry>();
  catalog.forEach((a, i) => {
    const key = artistKey(a.name);
    if (!key || entries.has(key)) return;
    entries.set(key, { key, name: a.name, id: a.id, catalogRank: i });
  });
  for (const a of popular) {
    const key = artistKey(a.name);
    if (!key) continue;
    const e = entries.get(key);
    if (e) {
      // Тёзки в открытом API: берём самого известного.
      if (e.fans === undefined || a.fans > e.fans) {
        e.fans = a.fans;
        if (a.imageUrl) e.imageUrl = a.imageUrl;
      }
    } else entries.set(key, { key, name: a.name, fans: a.fans, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) });
  }

  const card = (e: { name: string; id?: string; imageUrl?: string }): ArtistCard => {
    const id = e.id ?? knownIds?.get(artistKey(e.name));
    return { name: e.name, ...(id ? { id } : {}), ...(e.imageUrl ? { imageUrl: e.imageUrl } : {}) };
  };

  const out: ArtistCard[] = [];
  const used = new Set<string>();
  for (const o of own) {
    const key = artistKey(o.name);
    if (used.has(key) || !matchesArtistQuery(o.name, query)) continue;
    used.add(key);
    const found = entries.get(key);
    out.push(card({ name: o.name, id: o.id ?? found?.id, imageUrl: o.imageUrl ?? found?.imageUrl }));
  }

  const rest = [...entries.values()].filter((e) => !used.has(e.key) && isArtistCandidate(e.name, query));
  const known = rest.filter((e) => (e.fans ?? 0) >= MIN_FANS).sort((a, b) => (b.fans ?? 0) - (a.fans ?? 0) || (a.catalogRank ?? 1e9) - (b.catalogRank ?? 1e9));
  const others = rest
    .filter((e) => (e.fans ?? 0) < MIN_FANS)
    .sort((a, b) => (a.catalogRank ?? 1e9) - (b.catalogRank ?? 1e9) || (b.fans ?? 0) - (a.fans ?? 0));
  for (const e of [...known, ...others]) out.push(card(e));
  return out.slice(0, max);
}
