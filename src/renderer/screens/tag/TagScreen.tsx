import { AudioWaveform, LoaderCircle, Play } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { genreName } from '../../../shared/genres';
import type { SourceId } from '../../../shared/types';
import { Button } from '../../components/Button/Button';
import { genreIcon } from '../../components/GenreIcon/genreIcon';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { useBlacklist } from '../../stores/blacklistActions';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useWave } from '../../stores/useWave';
import { tracksOf, useSearchQueries, withoutBlockedStatus, type SourceStatus } from '../search/sourceQueries';
import { SourceSection } from '../search/SourceSection';
import { useGenreCatalog } from './genreCatalog';
import { genreSearchQueries, genreWaveSeed, mergeGenreStatuses } from './genreQueries';
import styles from './TagScreen.module.css';

/**
 * Свежая музыка жанра: YouTube первым, SoundCloud — дополнительно, затем подборки жанра в каталоге (`genreCatalog.ts`:
 * у редких сцен поиск видео — почти одни миксы). Internet Archive (старые записи) здесь не ищется.
 */
const SOURCES: SourceId[] = ['youtube', 'soundcloud'];
const ALL_SECTIONS: SourceId[] = [...SOURCES, 'catalog'];
const CATALOG_SHOWN = 50;

/** «Волна: <жанр>» — свежие подборки жанра и похожие на свежие треки страницы. */
function GenreWaveButton({ tag, year, fresh }: { tag: string; year: number; fresh: ReturnType<typeof tracksOf> }) {
  const key = `genre:${tag}`;
  const title = genreName(tag);
  const starting = useWave((s) => s.starting === key);
  const playing = useWave((s) => s.active?.title === title);
  return (
    <Button
      icon={starting ? LoaderCircle : AudioWaveform}
      className={starting ? 'spin-inner' : undefined}
      disabled={starting}
      aria-pressed={playing}
      onClick={() => {
        useLibrary.getState().recordGenre(tag);
        void useWave.getState().start(genreWaveSeed(tag, year, fresh), key);
      }}
    >
      Волна: {title}
    </Button>
  );
}

/** Страница жанра: «Волна: <жанр>» и свежие треки жанра. `param` — тег жанра. */
export function TagScreen({ param = '' }: { param?: string }) {
  const tag = param;
  const year = new Date().getFullYear();
  const queries = useMemo(() => genreSearchQueries(tag, year), [tag, year]);
  const entries = useSearchQueries((s) => s.entries);
  const catalog = useGenreCatalog((s) => s.entries[tag]);
  const blacklist = useBlacklist();
  const Icon = genreIcon(tag);

  // Открыл страницу жанра — жанр поднимается во вкусе (чипы и «Моя волна»).
  useEffect(() => {
    if (tag) useLibrary.getState().recordGenre(tag);
  }, [tag]);

  useEffect(() => {
    if (!tag) return;
    for (const q of queries) useSearchQueries.getState().ensure(q, SOURCES, true);
    useGenreCatalog.getState().ensure(tag, true);
  }, [tag, queries]);

  // Скрытые треки на странице жанра не показываются: таблицы, «Слушать» и волна получают один и тот же список.
  const statuses = useMemo(() => {
    const out: Partial<Record<SourceId, SourceStatus | undefined>> = {};
    for (const s of SOURCES) out[s] = withoutBlockedStatus(mergeGenreStatuses(s, queries.map((q) => entries[q]?.[s]), year), blacklist);
    out.catalog = withoutBlockedStatus(catalog, blacklist);
    return out;
  }, [entries, catalog, queries, year, blacklist]);
  const fresh = tracksOf(statuses.youtube);
  const firstList = ALL_SECTIONS.map((s) => tracksOf(statuses[s])).find((list) => list.length > 0) ?? [];

  return (
    <>
      <div className={styles.head}>
        <div className={styles.icon}>
          <Icon size={30} />
        </div>
        <div className={styles.headText}>
          <ScreenHeader
            eyebrow={`Жанр · свежее ${year}`}
            title={genreName(tag)}
            aside={
              <div className={styles.actions}>
                <GenreWaveButton tag={tag} year={year} fresh={fresh} />
                <Button variant="outline" icon={Play} disabled={firstList.length === 0} onClick={() => usePlayer.getState().playList(firstList, 0, genreName(tag))}>
                  Слушать
                </Button>
              </div>
            }
          />
        </div>
      </div>

      {ALL_SECTIONS.map((s) => (
        <SourceSection
          key={s}
          source={s}
          status={statuses[s]}
          emptyText={s === 'catalog' ? 'Подборок этого жанра не нашлось' : 'Свежего в этом жанре пока не нашлось'}
          onRetry={() => {
            if (s === 'catalog') useGenreCatalog.getState().retry(tag);
            else for (const q of queries) useSearchQueries.getState().retry(q, s);
          }}
          // Подборки — сотни треков: на странице первые 50, «Слушать» и очередь — весь список.
          limit={s === 'catalog' ? CATALOG_SHOWN : undefined}
          withTitle
          queueTitle={genreName(tag)}
        />
      ))}
    </>
  );
}
