import { describe, expect, it } from 'vitest';
import { formatDuration, formatTotalDuration, formatTrackCount, pluralRu, timeAgo } from './format';

describe('formatDuration', () => {
  it('минуты и секунды с ведущим нулём', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(260)).toBe('4:20');
    expect(formatDuration(76.9)).toBe('1:16');
  });
  it('часы — h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('неизвестная длительность — прочерк', () => {
    expect(formatDuration(undefined)).toBe('–:––');
    expect(formatDuration(NaN)).toBe('–:––');
    expect(formatDuration(-1)).toBe('–:––');
    expect(formatDuration(Infinity)).toBe('–:––');
  });
});

describe('timeAgo', () => {
  const now = new Date(2026, 9, 24, 18, 0, 0).getTime();
  const min = 60_000;
  it('меньше минуты — «только что»', () => {
    expect(timeAgo(now - 30_000, now)).toBe('только что');
    expect(timeAgo(now + 5_000, now)).toBe('только что');
  });
  it('минуты и часы', () => {
    expect(timeAgo(now - 4 * min, now)).toBe('4 мин назад');
    expect(timeAgo(now - 59 * min, now)).toBe('59 мин назад');
    expect(timeAgo(now - 2 * 60 * min, now)).toBe('2 ч назад');
  });
  it('дни со склонением', () => {
    const day = 24 * 60 * min;
    expect(timeAgo(now - day, now)).toBe('вчера');
    expect(timeAgo(now - 2 * day, now)).toBe('2 дня назад');
    expect(timeAgo(now - 5 * day, now)).toBe('5 дней назад');
    expect(timeAgo(now - 21 * day, now)).toBe('21 день назад');
  });
  it('старше месяца — дата', () => {
    expect(timeAgo(new Date(2026, 6, 3, 12).getTime(), now)).toBe('3 июл');
    expect(timeAgo(new Date(2025, 0, 15, 12).getTime(), now)).toBe('15 янв 2025');
  });
});

describe('pluralRu', () => {
  it('выбирает форму по числу', () => {
    const f = (n: number) => pluralRu(n, 'трек', 'трека', 'треков');
    expect([1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(f)).toEqual([
      'трек', 'трека', 'треков', 'треков', 'треков', 'треков', 'трек', 'трека', 'треков', 'трек', 'треков',
    ]);
  });
});

describe('formatTrackCount', () => {
  it('число и форма слова «трек»', () => {
    expect([0, 1, 3, 12, 21].map(formatTrackCount)).toEqual(['0 треков', '1 трек', '3 трека', '12 треков', '21 трек']);
  });
});

describe('formatTotalDuration', () => {
  it('общая длительность списка', () => {
    expect(formatTotalDuration(0)).toBe('0 мин');
    expect(formatTotalDuration(59 * 60 + 40)).toBe('1 ч');
    expect(formatTotalDuration(42 * 60 + 10)).toBe('42 мин');
    expect(formatTotalDuration(3 * 3600 + 12 * 60)).toBe('3 ч 12 мин');
    expect(formatTotalDuration(3600)).toBe('1 ч');
  });
});
