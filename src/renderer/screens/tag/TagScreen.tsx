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
import { tracksOf, useSearchQueries, withoutBlockedStatus } from '../search/sourceQueries';
import { SourceSection } from '../search/SourceSection';
import { genreSearchQueries, genreWaveSeed, mergeGenreStatuses } from './genreQueries';
import styles from './TagScreen.module.css';

/** Свежая музыка жанра: YouTube первым, SoundCloud — дополнительно. Internet Archive (старые записи) здесь не ищется. */
const SOURCES: SourceId[] = ['youtube', 'soundcloud'];

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
  const blacklist = useBlacklist();
  const Icon = genreIcon(tag);

  // Открыл страницу жанра — жанр поднимается во вкусе (чипы и «Моя волна»).
  useEffect(() => {
    if (tag) useLibrary.getState().recordGenre(tag);
  }, [tag]);

  useEffect(() => {
    if (!tag) return;
    for (const q of queries) useSearchQueries.getState().ensure(q, SOURCES, true);
  }, [tag, queries]);

  // Скрытые треки на странице жанра не показываются: таблицы, «Слушать» и волна получают один и тот же список.
  const statuses = useMemo(
    () =>
      Object.fromEntries(
        SOURCES.map((s) => [s, withoutBlockedStatus(mergeGenreStatuses(s, queries.map((q) => entries[q]?.[s]), year), blacklist)]),
      ),
    [entries, queries, year, blacklist],
  );
  const fresh = tracksOf(statuses.youtube);
  const firstList = SOURCES.map((s) => tracksOf(statuses[s])).find((list) => list.length > 0) ?? [];

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

      {SOURCES.map((s) => (
        <SourceSection
          key={s}
          source={s}
          status={statuses[s]}
          emptyText="Свежего в этом жанре пока не нашлось"
          onRetry={() => {
            for (const q of queries) useSearchQueries.getState().retry(q, s);
          }}
          withTitle
          queueTitle={genreName(tag)}
        />
      ))}
    </>
  );
}
