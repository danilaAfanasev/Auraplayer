// Тексты для слоя с текстом и кнопки «Текст» — чистые функции, чтобы проверять без DOM.
import type { LyricsStatus } from '../../stores/useLyrics';

/** Подсказка кнопки говорит её состояние: грузится — «Текст загружается…», нет текста — «Текста нет». */
export function lyricsButtonLabel(status: LyricsStatus): string {
  if (status === 'ready') return 'Текст песни';
  if (status === 'loading') return 'Текст загружается…';
  return 'Текста нет';
}

/** Что слой пишет вместо текста (трек сменился, текст ещё грузится или его нет). */
export function lyricsEmptyMessage(status: LyricsStatus): string {
  if (status === 'loading') return 'Текст загружается…';
  if (status === 'error') return 'Не удалось загрузить текст';
  return 'Текста нет';
}

/** Простой текст — абзацами (по пустым строкам); строки внутри абзаца сохраняются. */
export function plainParagraphs(text: string): string[][] {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line) {
      current.push(line);
    } else if (current.length > 0) {
      paragraphs.push(current);
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}
