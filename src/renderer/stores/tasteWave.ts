// Вкус → волна: сид «Моей волны» и живые чипы главной из скрытого рейтинга (shared/taste.ts) и жанров вкуса.
// Чистые функции — без DOM, сети и сторов. Зашитых артистов нет: нет вкуса — популярное своей страны и жанры.
import type { WaveSeed } from '../../shared/api';
import { artistKey, splitArtists } from '../../shared/artistNames';
import { isArtistBlocked, isBlocked } from '../../shared/blacklist';
import { GENRES, genreName } from '../../shared/genres';
import { artistScores } from '../../shared/taste';
import type { LibraryData, Track } from '../../shared/types';
import { genreWaveSeed } from '../screens/tag/genreQueries';

export interface WaveChip {
  /** Ключ кнопки (индикатор загрузки): `artist:<ключ>` или `genre:<тег>`. */
  id: string;
  /** Подпись чипа. */
  title: string;
  /** `seed.title` — стабильный заголовок волны, по нему чип показывает «играет». */
  seed: WaveSeed;
  /** Тег жанра — у жанровых чипов (включил — жанр поднимается во вкусе). */
  genre?: string;
}

export const MY_WAVE_TITLE = 'Моя волна';
/** Нейтральные жанры (теги `GENRES`) — пока вкуса нет. */
export const NEUTRAL_GENRES: readonly string[] = ['pop', 'hiphop', 'electronic', 'rock', 'indie'].filter((tag) =>
  GENRES.some((g) => g.tag === tag),
);

const MY_WAVE_ARTISTS = 12;
const MY_WAVE_TRACKS = 10;
/** Жанров вкуса в запросах «Моей волны». */
const MY_WAVE_GENRES = 3;
/** Нейтральная волна: жанров и треков «Популярного сейчас». */
const NEUTRAL_WAVE_GENRES = 4;
const NEUTRAL_WAVE_POPULAR = 20;
const CHIP_ARTISTS = 4;
const CHIP_GENRES = 2;
const CHIP_TOTAL = 5;

interface RankedArtist {
  key: string;
  name: string;
}

/**
 * Склейки исполнителей: подписка (или событие) на «A & B» при событиях на части «A», «B» — один артист «A & B»,
 * части в него вливаются. Часть, на которую пользователь подписан отдельно, остаётся собой.
 */
function compoundsOf(lib: LibraryData, names: readonly string[]): Map<string, RankedArtist> {
  const followedKeys = new Set(lib.followedArtists.map((a) => artistKey(a.name)));
  const out = new Map<string, RankedArtist>();
  // Имя подписки — как в каталоге, поэтому подписки первыми.
  for (const name of [...lib.followedArtists.map((a) => a.name), ...names]) {
    const parts = splitArtists(name);
    if (parts.length < 2) continue;
    const compound = { key: artistKey(name), name: name.trim() };
    if (!compound.key) continue;
    if (!out.has(compound.key)) out.set(compound.key, compound);
    for (const p of parts) {
      const key = artistKey(p);
      if (key && !followedKeys.has(key) && !out.has(key)) out.set(key, out.get(compound.key)!);
    }
  }
  return out;
}

/**
 * Артисты вкуса по убыванию: рейтинг (склейки и их части — вместе), затем — для библиотеки без журнала вкуса —
 * подписки и основные исполнители лайков и истории. Без скрытых и без тех, кого рейтинг опустил ниже нуля.
 */
function rankedArtists(lib: LibraryData, now: number): RankedArtist[] {
  const bl = lib.blacklist;
  const scores = artistScores(lib.taste, now, bl);
  const compounds = compoundsOf(lib, scores.map((s) => s.name));
  const canonical = (key: string, name: string): RankedArtist => compounds.get(key) ?? { key, name: name.trim() };

  const merged = new Map<string, { artist: RankedArtist; score: number }>();
  for (const s of scores) {
    const artist = canonical(s.key, s.name);
    const entry = merged.get(artist.key);
    if (entry) entry.score += s.score;
    else merged.set(artist.key, { artist, score: s.score });
  }
  const out = [...merged.values()].sort((a, b) => b.score - a.score).map((e) => e.artist);

  // Пропускал или «Не нравится» — рейтинг не выше нуля: запасной список его не возвращает.
  const disliked = new Set(lib.taste.events.map((e) => artistKey(e.artist)).filter((k) => !merged.has(canonical(k, k).key)));
  const seen = new Set(out.map((a) => a.key));
  const add = (name: string | undefined) => {
    if (!name) return;
    const key = artistKey(name);
    if (!key) return;
    const artist = canonical(key, name);
    if (seen.has(artist.key) || disliked.has(key)) return;
    seen.add(artist.key);
    out.push(artist);
  };
  for (const a of lib.followedArtists) add(a.name);
  for (const t of seedTracks(lib)) add(splitArtists(t.artist, t.title)[0]);
  return out.filter((a) => !isArtistBlocked(a.name, bl));
}

/** Лайки, затем недавние — без скрытых треков и треков скрытых исполнителей, без повторов. */
function seedTracks(lib: LibraryData): Track[] {
  const out: Track[] = [];
  const ids = new Set<string>();
  const add = (t: Track | undefined) => {
    if (!t || ids.has(t.id) || isBlocked(t, lib.blacklist)) return;
    ids.add(t.id);
    out.push(t);
  };
  for (const id of lib.likes) add(lib.tracks[id]);
  for (const h of lib.history) add(lib.tracks[h.trackId]);
  return out;
}

/** Запрос жанра для волны: первый из запросов «Волны: <жанр>» («рэп 2026»). */
function genreQuery(tag: string, year: number): string | null {
  return genreWaveSeed(tag, year, []).queries?.[0] ?? null;
}

const queriesOf = (tags: readonly string[], year: number): string[] =>
  [...new Set(tags.map((tag) => genreQuery(tag, year)).filter((q): q is string => !!q))];

/**
 * «Моя волна» из вкуса: до 12 артистов с наибольшим рейтингом (выше рейтинг — раньше), лайки и недавние —
 * стартовые треки, жанры вкуса — дополнительные запросы. Нет ни артистов, ни жанров — нейтральная волна:
 * `popular` («Популярное сейчас» своей страны) и жанровые запросы, без артистов.
 */
export function myWaveSeed(lib: LibraryData, now: number, popular: readonly Track[] = []): WaveSeed {
  const year = new Date(now).getFullYear();
  const artists = rankedArtists(lib, now)
    .slice(0, MY_WAVE_ARTISTS)
    .map((a) => a.name);
  const tracks = seedTracks(lib).slice(0, MY_WAVE_TRACKS);
  const genres = lib.taste.genres.slice(0, MY_WAVE_GENRES);
  const seed: WaveSeed = { title: MY_WAVE_TITLE };
  if (artists.length > 0) seed.artists = artists;
  if (tracks.length > 0) seed.tracks = tracks;
  if (artists.length === 0) {
    // Нейтральная волна: популярное (оно же первые треки) и жанры — свои или нейтральные.
    const extra = popular.filter((t) => !isBlocked(t, lib.blacklist)).slice(0, NEUTRAL_WAVE_POPULAR);
    if (extra.length > 0) seed.extra = extra;
    seed.queries = queriesOf(genres.length > 0 ? genres : NEUTRAL_GENRES.slice(0, NEUTRAL_WAVE_GENRES), year);
  } else if (genres.length > 0) {
    seed.queries = queriesOf(genres, year);
  }
  return seed;
}

/** Есть ли у пользователя свой вкус (артисты или жанры) — иначе «Моя волна» нейтральная. */
export function hasTaste(lib: LibraryData, now: number): boolean {
  return lib.taste.genres.length > 0 || rankedArtists(lib, now).length > 0;
}

function genreChip(tag: string, year: number): WaveChip {
  return { id: `genre:${tag}`, title: genreName(tag), genre: tag, seed: genreWaveSeed(tag, year, []) };
}

/**
 * Чипы главной: 3–4 «Волна по <артист>» по текущему рейтингу и 1–2 жанра вкуса (артистов мало — жанров больше),
 * до пяти добираются нейтральными жанрами. Нет вкуса — 5 нейтральных жанровых чипов.
 */
export function tasteChips(lib: LibraryData, now: number): WaveChip[] {
  const year = new Date(now).getFullYear();
  const artists = rankedArtists(lib, now).slice(0, CHIP_ARTISTS);
  const chips: WaveChip[] = artists.map((a) => ({
    id: `artist:${a.key}`,
    title: `Волна по ${a.name}`,
    seed: { title: a.name, artists: [a.name] },
  }));
  const genreSlots = Math.max(CHIP_GENRES, CHIP_TOTAL - chips.length);
  const tags = lib.taste.genres.filter((tag) => GENRES.some((g) => g.tag === tag)).slice(0, genreSlots);
  for (const tag of tags) chips.push(genreChip(tag, year));
  for (const tag of NEUTRAL_GENRES) {
    if (chips.length >= CHIP_TOTAL) break;
    if (!chips.some((c) => c.genre === tag)) chips.push(genreChip(tag, year));
  }
  return chips;
}
