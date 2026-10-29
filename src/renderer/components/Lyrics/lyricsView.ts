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

// ---------- Лесенка строк синхронного текста ----------

/** Соседняя с текущей строка — во столько раз от текущей (текущая крупнее в ~1,35 раза). */
const LADDER_NEAR_SCALE = 0.74;
/** Каждая следующая ступень мельче на столько. */
const LADDER_SCALE_STEP = 0.1;
/** Мельче не бывает: строка остаётся читаемой. */
const LADDER_MIN_SCALE = 0.5;
const LADDER_NEAR_OPACITY = 0.78;
const LADDER_OPACITY_STEP = 0.16;
const LADDER_MIN_OPACITY = 0.22;

/** Размер и непрозрачность строки в `distance` ступенях от текущей (0 — текущая). */
export function ladderStyle(distance: number): { scale: number; opacity: number } {
  const d = Math.abs(Math.round(distance));
  if (d === 0) return { scale: 1, opacity: 1 };
  return {
    scale: Math.max(LADDER_MIN_SCALE, Math.round((LADDER_NEAR_SCALE - LADDER_SCALE_STEP * (d - 1)) * 1000) / 1000),
    opacity: Math.max(LADDER_MIN_OPACITY, Math.round((LADDER_NEAR_OPACITY - LADDER_OPACITY_STEP * (d - 1)) * 1000) / 1000),
  };
}

export interface LadderRow {
  scale: number;
  opacity: number;
  /** Сдвиг строки по вертикали, px: уменьшенные строки подтягиваются к текущей, зазор между ними — как в вёрстке. */
  shift: number;
}

/**
 * Лесенка вокруг строки `marker` (текущей по звуку или строки-цели при перемотке): вёрстка строк не меняется
 * (все — размера текущей), меняются только `transform` и `opacity` — смена строки плавная, строка в две строки
 * не двигает соседей скачком. `heights` — высоты строк в вёрстке, `skip` — пустые строки-паузы (не ступени);
 * зазор между строками не масштабируется и остаётся прежним. `marker` = -1 (до первой строки) — никто не выделен.
 */
export function ladderLayout(heights: number[], skip: boolean[], marker: number): LadderRow[] {
  const n = heights.length;
  // Номер строки среди непустых: ступени считаются только по ним.
  const order: number[] = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    order[i] = k;
    if (!skip[i]) k++;
  }
  const first = skip.findIndex((s) => !s);
  const anchor = marker >= 0 && marker < n ? marker : Math.max(0, first);
  const base = marker >= 0 && marker < n ? order[marker] : -1;
  const rows: LadderRow[] = heights.map((_, i) => {
    // Пауза берёт ступень следующей за ней строки в сторону от текущей.
    const d = skip[i] && i > anchor ? order[i] - base : skip[i] ? order[i] - 1 - base : order[i] - base;
    return { ...ladderStyle(d), shift: 0 };
  });
  // Сдвиг: сколько высоты «съели» уменьшения между якорем и строкой (половины — у якоря и у самой строки).
  const shrink = (i: number): number => (heights[i] ?? 0) * (1 - rows[i].scale);
  for (let i = anchor + 1, acc = shrink(anchor) / 2; i < n; i++) {
    rows[i].shift = -(acc + shrink(i) / 2);
    acc += shrink(i);
  }
  for (let i = anchor - 1, acc = shrink(anchor) / 2; i >= 0; i--) {
    rows[i].shift = acc + shrink(i) / 2;
    acc += shrink(i);
  }
  return rows;
}
