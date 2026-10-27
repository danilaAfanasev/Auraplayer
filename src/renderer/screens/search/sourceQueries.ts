// Запросы к источникам из экранов (поиск, жанр, главная): у каждого источника своё состояние,
// ответы кэшируются на время работы приложения, чтобы возврат на экран был мгновенным.
import { create } from 'zustand';
import { withoutBlocked, type Blacklist } from '../../../shared/blacklist';
import type { SourceId, SourceResult } from '../../../shared/types';
import { errorMessage } from '../../app/errors';

export type SourceStatus = { status: 'loading' } | { status: 'done'; result: SourceResult };

type Fetcher = (source: SourceId, key: string) => Promise<SourceResult>;

interface QueryStore {
  entries: Record<string, Partial<Record<SourceId, SourceStatus>>>;
  /** Запрашивает источники, у которых для `key` ещё нет ответа (или он с ошибкой, если `refreshErrors`). */
  ensure(key: string, sources: readonly SourceId[], refreshErrors?: boolean): void;
  retry(key: string, source: SourceId): void;
}

const MAX_KEYS = 30;

function createQueryStore(fetcher: Fetcher) {
  return create<QueryStore>((set, get) => {
    const put = (key: string, source: SourceId, status: SourceStatus) => {
      const entries = { ...get().entries };
      entries[key] = { ...entries[key], [source]: status };
      const keys = Object.keys(entries);
      if (keys.length > MAX_KEYS) delete entries[keys[0]];
      set({ entries });
    };

    const run = (key: string, source: SourceId) => {
      put(key, source, { status: 'loading' });
      fetcher(source, key)
        .catch(
          (err: unknown): SourceResult => ({
            source,
            tracks: [],
            error: { kind: 'unknown', message: errorMessage(err, 'Сервис недоступен') },
          }),
        )
        .then((result) => put(key, source, { status: 'done', result }));
    };

    return {
      entries: {},
      ensure(key, sources, refreshErrors = false) {
        const entry = get().entries[key] ?? {};
        for (const source of sources) {
          const st = entry[source];
          if (!st || (refreshErrors && st.status === 'done' && st.result.error)) run(key, source);
        }
      },
      retry(key, source) {
        run(key, source);
      },
    };
  });
}

export const useSearchQueries = createQueryStore((source, query) => window.aura.search(source, query));
export const useTagQueries = createQueryStore((source, tag) => window.aura.byTag(source, tag));
export const useFeaturedQueries = createQueryStore((source) => window.aura.featured(source));

/** Треки источника (пусто, пока грузится или при ошибке). */
export function tracksOf(st: SourceStatus | undefined) {
  return st?.status === 'done' ? st.result.tracks : [];
}

/**
 * Ответ источника без треков из чёрного списка — для подборок, где скрытое не показывается (страницы жанров).
 * Поиск свои ответы не фильтрует: там скрытое видно приглушённым (`TrackTable`).
 */
export function withoutBlockedStatus(st: SourceStatus | undefined, bl: Blacklist): SourceStatus | undefined {
  if (st?.status !== 'done') return st;
  const tracks = withoutBlocked(st.result.tracks, bl, (t) => t);
  return tracks === st.result.tracks ? st : { status: 'done', result: { ...st.result, tracks } };
}
