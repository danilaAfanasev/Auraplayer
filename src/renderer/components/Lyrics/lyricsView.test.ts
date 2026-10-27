import { describe, expect, it } from 'vitest';
import { lyricsButtonLabel, lyricsEmptyMessage, plainParagraphs } from './lyricsView';

describe('lyricsButtonLabel: три состояния кнопки «Текст»', () => {
  it('текст есть — обычная подсказка', () => {
    expect(lyricsButtonLabel('ready')).toBe('Текст песни');
  });
  it('текст ищется — «Текст загружается…»', () => {
    expect(lyricsButtonLabel('loading')).toBe('Текст загружается…');
  });
  it('текста нет, не нашёлся или сбой — «Текста нет»', () => {
    for (const status of ['none', 'error', 'idle'] as const) expect(lyricsButtonLabel(status)).toBe('Текста нет');
  });
});

describe('lyricsEmptyMessage: что слой пишет вместо текста', () => {
  it('грузится — ждём; нет текста — «Текста нет»; сбой — отдельная фраза', () => {
    expect(lyricsEmptyMessage('loading')).toBe('Текст загружается…');
    expect(lyricsEmptyMessage('none')).toBe('Текста нет');
    expect(lyricsEmptyMessage('idle')).toBe('Текста нет');
    expect(lyricsEmptyMessage('error')).toBe('Не удалось загрузить текст');
  });
});

describe('plainParagraphs', () => {
  it('делит простой текст на абзацы по пустым строкам, строки сохраняет', () => {
    expect(plainParagraphs('раз\nдва\n\nтри\nчетыре\n')).toEqual([['раз', 'два'], ['три', 'четыре']]);
  });
  it('лишние пустые строки, пробелы и \r не плодят пустых абзацев', () => {
    expect(plainParagraphs('\r\n  а  \r\n\r\n\r\n\r\nб\r\n\r\n')).toEqual([['а'], ['б']]);
  });
  it('пусто — нет абзацев', () => {
    expect(plainParagraphs('  \n\n ')).toEqual([]);
  });
});
