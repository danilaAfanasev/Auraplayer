// Подборки жанра в каталоге — третий раздел страницы жанра: треки подборок по названию сцены («witch house», «фонк»)
// из открытого API через main (`aura.wave.start` с запросами жанра). У редких жанров поиск видео отдаёт почти одни
// миксы — подборки дают песни этого стиля. Звук треков каталога ищется на YouTube, как у волны и чарта.
import { create } from 'zustand';
import { genreName } from '../../../shared/genres';
import { errorMessage } from '../../app/errors';
import { useSettings } from '../../stores/useSettings';
import type { SourceStatus } from '../search/sourceQueries';
import { freshGenreTracks, genrePlaylistQueries } from './genreQueries';

/** Звук треков каталога ищется на YouTube. */
const DISABLED_MESSAGE = 'Треки подборок играют через YouTube — включи YouTube в настройках';

interface GenreCatalogState {
  /** Ответ по тегу жанра; нет записи — ещё не запрашивали. */
  entries: Record<string, SourceStatus>;
  /** Запросить подборки жанра, если их ещё нет (или прошлый ответ — ошибка и `refreshErrors`). */
  ensure(tag: string, refreshErrors?: boolean): void;
  retry(tag: string): void;
}

export const useGenreCatalog = create<GenreCatalogState>((set, get) => {
  async function load(tag: string): Promise<void> {
    set((s) => ({ entries: { ...s.entries, [tag]: { status: 'loading' } } }));
    const year = new Date().getFullYear();
    let status: SourceStatus;
    if (!useSettings.getState().settings.youtubeEnabled) {
      status = { status: 'done', result: { source: 'catalog', tracks: [], error: { kind: 'disabled', message: DISABLED_MESSAGE } } };
    } else {
      try {
        const tracks = await window.aura.wave.start({ title: genreName(tag), queries: genrePlaylistQueries(tag) });
        status = { status: 'done', result: { source: 'catalog', tracks: freshGenreTracks([tracks], year) } };
      } catch (err) {
        const message = errorMessage(err, 'Подборки жанра не загрузились');
        status = { status: 'done', result: { source: 'catalog', tracks: [], error: { kind: 'unavailable', message } } };
      }
    }
    set((s) => ({ entries: { ...s.entries, [tag]: status } }));
  }

  return {
    entries: {},
    ensure(tag, refreshErrors = false) {
      const known = get().entries[tag];
      if (known && !(refreshErrors && known.status === 'done' && known.result.error)) return;
      void load(tag);
    },
    retry(tag) {
      void load(tag);
    },
  };
});
