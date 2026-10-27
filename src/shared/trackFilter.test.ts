import { describe, expect, it } from 'vitest';
import { isLikelyTrack, LONG_TRACK_SEC, MIN_TRACK_SEC } from './trackFilter';

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

describe('isLikelyTrack: короткие не-треки и «24 часа»', () => {
  it('интервью-ответы, Q&A, тизеры, превью, бэкстейдж и шортс отсеиваются', () => {
    for (const title of [
      'OG BUDA ОТВЕЧАЕТ НА 20 ВОПРОСОВ | ЧТО ДАЛЬШЕ?',
      'Артист отвечает на вопросы фанатов',
      '10 глупых вопросов рэперу',
      'Q&A with the band',
      'Вопрос-ответ #3',
      'Тизер нового альбома',
      'New Song (Teaser)',
      'Album Trailer',
      'Album Preview',
      'Official Trailer',
      'New Song (Snippet)',
      'Сниппет трека',
      'Клип (Backstage)',
      'Backstage video',
      'Song #shorts',
      'Шортс про студию',
    ]) {
      expect(isLikelyTrack({ title, durationSec: 232 }), title).toBe(false);
    }
  });

  it('обычные песни с похожими словами проходят', () => {
    for (const title of ['Без вопросов', 'Вопросы', 'Ответ', 'Short Story', 'Ночной разговор']) {
      expect(isLikelyTrack({ title, durationSec: 190 }), title).toBe(true);
    }
  });

  it('обрывки короче 30 секунд в поиске отсеиваются, интро и скиты альбомов (0:40) — нет', () => {
    expect(MIN_TRACK_SEC).toBe(30);
    expect(isLikelyTrack({ title: 'madk1d', durationSec: 6 })).toBe(false);
    expect(isLikelyTrack({ title: 'Full', durationSec: 25 })).toBe(false);
    expect(isLikelyTrack({ title: 'Интро', durationSec: 29 })).toBe(false);
    expect(isLikelyTrack({ title: 'Интро', durationSec: 30 })).toBe(true);
    expect(isLikelyTrack({ title: 'Intro', durationSec: 40 })).toBe(true);
    expect(isLikelyTrack({ title: 'Скит', durationSec: 35 })).toBe(true);
    expect(isLikelyTrack({ title: 'Без длительности' })).toBe(true);
  });

  it('«24 часа» и «24 Hours» на три минуты — песни; часовой ролик — нет', () => {
    expect(isLikelyTrack({ title: '24 часа', durationSec: 185 })).toBe(true);
    expect(isLikelyTrack({ title: 'Artist - 24 Hours', durationSec: 201 })).toBe(true);
    expect(isLikelyTrack({ title: '24 Hours (Official Video)', durationSec: 214 })).toBe(true);
    expect(isLikelyTrack({ title: '24 часа' })).toBe(true);
    expect(isLikelyTrack({ title: '1 час музыки для сна', durationSec: 3600 })).toBe(false);
    expect(isLikelyTrack({ title: '24 Hours', durationSec: 3600, official: true })).toBe(false);
    expect(isLikelyTrack({ title: 'Song 1 hour version', durationSec: 240 })).toBe(false);
    expect(isLikelyTrack({ title: 'Song 10 hours loop' })).toBe(false);
  });
});

describe('isLikelyTrack: без ложных срабатываний (ревью)', () => {
  it('клипы и версии песни «24 Hours» / «24 часа» проходят: слова длинного ролика — только вплотную к часам', () => {
    for (const title of [
      'Sky Ferreira - 24 Hours (Official Music Video)',
      'Элджей - 24 часа (Official Music Video)',
      '24 Hours (Radio Mix)',
      '24 Hours (Acoustic Version)',
    ]) {
      expect(isLikelyTrack({ title, durationSec: 215 }), title).toBe(true);
    }
    for (const title of ['Phonk 10 hours of drift', '1 hour mix of phonk', 'Rain 1 hour loop']) {
      expect(isLikelyTrack({ title, durationSec: 215 }), title).toBe(false);
    }
  });

  it('одиночные trailer/teaser/preview/snippet — песни; официальное аудио этими словами не режется', () => {
    for (const title of ['Little Big - Trailer Park', 'Modest Mouse - Trailer Trash', 'Deep Purple - Teaser', 'Preview', 'Snippet of Love']) {
      expect(isLikelyTrack({ title, durationSec: 200 }), title).toBe(true);
    }
    expect(isLikelyTrack({ title: 'Song (Snippet)', durationSec: 200, official: true })).toBe(true);
    expect(isLikelyTrack({ title: 'Official Trailer', durationSec: 200, official: true })).toBe(true);
  });

  it('«за кадром», «не отвечает на звонки», «99 вопросов», «Backstage Pass» — песни', () => {
    for (const title of ['Остаться за кадром', 'Она не отвечает на звонки', '99 вопросов', 'Backstage Pass']) {
      expect(isLikelyTrack({ title, durationSec: 200 }), title).toBe(true);
    }
  });
});