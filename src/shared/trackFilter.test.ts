import { describe, expect, it } from 'vitest';
import { isLikelyTrack, LONG_TRACK_SEC } from './trackFilter';

describe('isLikelyTrack', () => {
  it('обычная песня проходит, с длительностью и без', () => {
    expect(isLikelyTrack({ title: 'Bandana', durationSec: 152 })).toBe(true);
    expect(isLikelyTrack({ title: 'Без длительности' })).toBe(true);
    expect(isLikelyTrack({ title: 'ДИНАСТИЯ (official music video)', durationSec: 165 })).toBe(true);
  });

  it('интервью, подкасты, разборы и прочие ролики отсеиваются при любой длительности', () => {
    for (const title of [
      'madk1d — интервью (4 минуты)',
      'Artist - Song (Интервью)',
      'Big Interview with Artist',
      'Подкаст про музыку',
      'Реакция на новый альбом',
      'Artist Reaction',
      'Разбор текста',
      'Обзор альбома',
      'Album Review',
      'Прямой стрим',
      'Studio stream',
      'Artist - Album (Full Album)',
      'Полный альбом',
      'Альбом целиком',
      '1 Hour of Phonk',
      '10 hours loop',
      'Phonk Mix 2026',
      'DJ Mix vol. 3',
      'Hits mixtape full',
      'Русский микс',
      'Сборник лучших песен',
      'Compilation 2026',
      'Live stream',
      'Трансляция концерта',
      'Документальный фильм',
      'Documentary about band',
      'Мой влог',
      'Daily vlog',
      'Behind the scenes',
    ]) {
      expect(isLikelyTrack({ title, durationSec: 240 }), title).toBe(false);
      expect(isLikelyTrack({ title, durationSec: 240, official: true }), `${title} (official)`).toBe(false);
    }
  });

  it('Remix и версии «… Mix» — это треки, а не миксы', () => {
    expect(isLikelyTrack({ title: 'Секрет или тайна (Remix)', durationSec: 129 })).toBe(true);
    expect(isLikelyTrack({ title: 'Cristal & МОЁТ (Remix) [Official Video]', durationSec: 220 })).toBe(true);
    expect(isLikelyTrack({ title: 'Song (Radio Mix)', durationSec: 200 })).toBe(true);
    expect(isLikelyTrack({ title: 'Song (Extended Mix)', durationSec: 400 })).toBe(true);
  });

  it('длиннее 8 минут — только официальное аудио', () => {
    expect(LONG_TRACK_SEC).toBe(480);
    expect(isLikelyTrack({ title: 'Long instrumental', durationSec: 480 })).toBe(true);
    expect(isLikelyTrack({ title: 'Long instrumental', durationSec: 481 })).toBe(false);
    expect(isLikelyTrack({ title: 'Long instrumental', durationSec: 660 })).toBe(false);
    expect(isLikelyTrack({ title: 'Long instrumental', durationSec: 660, official: true })).toBe(true);
    expect(isLikelyTrack({ title: 'Ролик на полтора часа', durationSec: 5400 })).toBe(false);
  });
});
