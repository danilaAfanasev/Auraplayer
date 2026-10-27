// Вкус — скрытый рейтинг исполнителей, который Aura ведёт сама. Чистые функции над журналом событий
// (исполнитель, тип, время); рейтинг считается при чтении, с остыванием: вклад события вдвое меньше
// через `TASTE_HALF_LIFE_MS`. Хранится в `library.json` (`LibraryData.taste`).
import { artistKey } from './artistNames';
import { isArtistBlocked, type Blacklist } from './blacklist';

export type TasteEventKind = 'complete' | 'like' | 'follow' | 'onboard' | 'skip' | 'dislike';

export interface TasteEvent {
  /** Отображаемое имя одного исполнителя. */
  artist: string;
  kind: TasteEventKind;
  at: number;
}

export interface Taste {
  /** Журнал, старые первыми, не больше `TASTE_EVENT_LIMIT`. */
  events: TasteEvent[];
  /** Теги жанров (`GENRES`): выбранные на первом запуске и включённые позже, последние первыми, не больше `TASTE_GENRE_LIMIT`. */
  genres: string[];
}

export interface ArtistScore {
  key: string;
  /** Имя из самого свежего события. */
  name: string;
  score: number;
}

export const TASTE_WEIGHTS: Record<TasteEventKind, number> = {
  complete: 1,
  like: 3,
  follow: 4,
  onboard: 4,
  skip: -1.5,
  dislike: -4,
};

export const TASTE_HALF_LIFE_MS = 14 * 86_400_000;
export const TASTE_EVENT_LIMIT = 2000;
export const TASTE_GENRE_LIMIT = 8;

const KINDS = Object.keys(TASTE_WEIGHTS) as TasteEventKind[];

export function emptyTaste(): Taste {
  return { events: [], genres: [] };
}

function isTasteEvent(v: unknown): v is TasteEvent {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.artist === 'string' &&
    artistKey(e.artist) !== '' &&
    KINDS.includes(e.kind as TasteEventKind) &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at)
  );
}

/** Дописывает события в журнал; сверх лимита уходят самые старые. */
export function addTasteEvents(taste: Taste, events: TasteEvent[]): Taste {
  const fresh = events.filter(isTasteEvent).map((e) => ({ artist: e.artist.trim(), kind: e.kind, at: e.at }));
  if (fresh.length === 0) return taste;
  return { ...taste, events: [...taste.events, ...fresh].slice(-TASTE_EVENT_LIMIT) };
}

/** Рейтинг на момент `now`: по убыванию, только положительный, без исполнителей из чёрного списка. */
export function artistScores(taste: Taste, now: number, bl?: Blacklist): ArtistScore[] {
  const byKey = new Map<string, { name: string; at: number; score: number }>();
  for (const e of taste.events) {
    const key = artistKey(e.artist);
    if (!key) continue;
    const age = Math.max(0, now - e.at);
    const contribution = TASTE_WEIGHTS[e.kind] * Math.pow(0.5, age / TASTE_HALF_LIFE_MS);
    const entry = byKey.get(key);
    if (!entry) byKey.set(key, { name: e.artist, at: e.at, score: contribution });
    else {
      entry.score += contribution;
      if (e.at >= entry.at) {
        entry.at = e.at;
        entry.name = e.artist;
      }
    }
  }
  const out: ArtistScore[] = [];
  for (const [key, { name, score }] of byKey) {
    if (score <= 1e-9) continue;
    if (bl && isArtistBlocked(name, bl)) continue;
    out.push({ key, name, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Жанры: без повторов и пустых, не больше `TASTE_GENRE_LIMIT`, порядок сохраняется. */
export function cleanGenres(tags: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const tag = t.trim();
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= TASTE_GENRE_LIMIT) break;
  }
  return out;
}

export function normalizeTaste(raw: unknown): Taste {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyTaste();
  const r = raw as Record<string, unknown>;
  const events = Array.isArray(r.events) ? addTasteEvents(emptyTaste(), r.events as TasteEvent[]).events : [];
  const genres = Array.isArray(r.genres) ? cleanGenres(r.genres) : [];
  return { events, genres };
}
