import { describe, expect, it } from 'vitest';
import { blockArtist, emptyBlacklist } from './blacklist';
import {
  addTasteEvents,
  artistScores,
  emptyTaste,
  normalizeTaste,
  TASTE_EVENT_LIMIT,
  TASTE_HALF_LIFE_MS,
  TASTE_WEIGHTS,
  type TasteEvent,
} from './taste';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const ev = (artist: string, kind: TasteEvent['kind'], at = NOW): TasteEvent => ({ artist, kind, at });
const scoreOf = (events: TasteEvent[], name: string, now = NOW) =>
  artistScores(addTasteEvents(emptyTaste(), events), now).find((s) => s.name === name)?.score ?? 0;

describe('вкус: рейтинг исполнителей', () => {
  it('веса событий — как договорились', () => {
    expect(TASTE_WEIGHTS).toEqual({ complete: 1, like: 3, follow: 4, onboard: 4, skip: -1.5, dislike: -4 });
    expect(TASTE_HALF_LIFE_MS).toBe(14 * DAY);
    expect(TASTE_EVENT_LIMIT).toBe(2000);
  });

  it('растёт от «дослушал», лайка и подписки, падает от пропуска и «Не нравится»', () => {
    expect(scoreOf([ev('A', 'complete')], 'A')).toBeCloseTo(1);
    expect(scoreOf([ev('A', 'complete'), ev('A', 'like'), ev('A', 'follow')], 'A')).toBeCloseTo(8);
    expect(scoreOf([ev('A', 'like'), ev('A', 'skip')], 'A')).toBeCloseTo(1.5);
    // ниже нуля — не в рейтинге
    expect(scoreOf([ev('A', 'complete'), ev('A', 'dislike')], 'A')).toBe(0);
  });

  it('остывает: вклад события через 14 дней — вдвое меньше, через 28 — вчетверо', () => {
    expect(scoreOf([ev('A', 'like', NOW - 14 * DAY)], 'A')).toBeCloseTo(1.5);
    expect(scoreOf([ev('A', 'follow', NOW - 28 * DAY)], 'A')).toBeCloseTo(1);
  });

  it('по убыванию; одно имя в разном написании — один исполнитель; без чёрного списка', () => {
    const taste = addTasteEvents(emptyTaste(), [
      ev('Low', 'complete'),
      ev('madk1d', 'like'),
      ev('MADK1D', 'complete'),
      ev('Bad', 'follow'),
    ]);
    const scores = artistScores(taste, NOW);
    expect(scores.map((s) => [s.key, s.score])).toEqual([
      ['madk1d', 4],
      ['bad', 4],
      ['low', 1],
    ]);
    expect(scores[0].name).toBe('MADK1D');
    const bl = blockArtist(emptyBlacklist(), { name: 'bad' }, NOW);
    expect(artistScores(taste, NOW, bl).map((s) => s.key)).toEqual(['madk1d', 'low']);
  });

  it('журнал не длиннее 2000 событий: старые уходят первыми', () => {
    const many = Array.from({ length: TASTE_EVENT_LIMIT + 5 }, (_, i) => ev(`A${i}`, 'complete', NOW - (3000 - i)));
    const taste = addTasteEvents(addTasteEvents(emptyTaste(), many.slice(0, 1000)), many.slice(1000));
    expect(taste.events).toHaveLength(TASTE_EVENT_LIMIT);
    expect(taste.events[0].artist).toBe('A5');
    expect(taste.events.at(-1)!.artist).toBe(`A${TASTE_EVENT_LIMIT + 4}`);
  });
});

describe('normalizeTaste', () => {
  it('мусор — пустой вкус; битые события отбрасываются; жанров не больше 8, без повторов', () => {
    expect(normalizeTaste(null)).toEqual(emptyTaste());
    expect(emptyTaste()).toEqual({ events: [], genres: [] });
    const t = normalizeTaste({
      events: [ev('A', 'like'), { artist: 'B', kind: 'hate', at: 1 }, { artist: '', kind: 'like', at: 1 }, { artist: 'C', kind: 'skip' }, 5],
      genres: ['rock', 'pop', 'rock', 3, 'jazz', 'a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(t.events).toEqual([ev('A', 'like')]);
    expect(t.genres).toEqual(['rock', 'pop', 'jazz', 'a', 'b', 'c', 'd', 'e']);
  });
});
