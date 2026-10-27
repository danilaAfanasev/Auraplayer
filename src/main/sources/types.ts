// Общий интерфейс адаптеров источников (main-процесс). Рендерер не знает, откуда трек:
// он вызывает window.aura.search/featured/byTag/resolveStream, а main выбирает адаптер.
import type { StreamOptions } from '../../shared/api';
import type { Settings, SourceErrorKind, SourceId, Track } from '../../shared/types';

/** Параметры потока в main: `signal` — подготовка устарела (пользователь пролистал), yt-dlp убивается. */
export interface AdapterStreamOptions extends StreamOptions {
  signal?: AbortSignal;
}

export type { StreamOptions };

export interface SourceContext {
  settings: Settings;
  userDataDir: string;
}

export interface SourceAdapter {
  id: SourceId;
  search(query: string, ctx: SourceContext): Promise<Track[]>;
  /** Популярное для главной. */
  featured?(ctx: SourceContext): Promise<Track[]>;
  byTag?(tag: string, ctx: SourceContext): Promise<Track[]>;
  /** URL для `<audio>`; `opts.fresh` — не брать сохранённую ссылку (повторная попытка плеера), `opts.signal` — отмена. */
  resolveStream(track: Track, ctx: SourceContext, opts?: AdapterStreamOptions): Promise<string>;
  /** Итоговый путь файла (расширение может уточниться). Реализует таск скачивания. */
  download?(
    track: Track,
    destPath: string,
    ctx: SourceContext,
    onProgress: (p: number) => void,
    signal: AbortSignal,
  ): Promise<string>;
}

/** Человеческие тексты состояний источника — то, что видит пользователь. */
export const SOURCE_ERROR_MESSAGES: Record<SourceErrorKind, string> = {
  offline: 'Нет соединения',
  unavailable: 'Сервис недоступен',
  disabled: 'Источник выключен в настройках',
  unknown: 'Что-то пошло не так',
};

/** Ошибка источника с видом состояния: рендерер показывает её у этого источника, остальные не трогает. */
export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string = SOURCE_ERROR_MESSAGES[kind],
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
