import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { POPULAR_GENRES } from '../../../shared/genres';
import { genreIcon } from '../../components/GenreIcon/genreIcon';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { useFeed, useFeedInit } from '../../stores/useFeed';
import { useLibrary } from '../../stores/useLibrary';
import { useUi } from '../../stores/useUi';
import { useReleaseTracks } from '../artist/artistData';
import { useCharts, useChartsInit } from '../charts/useCharts';
import { FollowSuggestions } from '../following/FollowSuggestions';
import { ChartBlock } from './CatalogBlocks';
import { CatalogHero } from './CatalogHero';
import { FollowedFeedBlock, SimilarFeedBlock, useFeedView } from './FeedBlocks';
import { chartHero, releaseHero } from './heroRelease';
import styles from './HomeScreen.module.css';
import { WaveBlock } from './WaveBlock';

/** Сколько релизов показывать в лентах главной (остальное — в «Моих артистах»). */
const FEED_PREVIEW = 12;

function HeroSkeleton() {
  return (
    <section className={[styles.hero, styles.heroLoading].join(' ')} aria-label="Загрузка подборки">
      <div className={styles.heroBody}>
        <Skeleton width={180} height={12} />
        <Skeleton width="70%" height={40} radius={12} />
        <Skeleton width="45%" height={14} />
        <div className={styles.heroActions}>
          <Skeleton width={130} height={44} radius={999} />
          <Skeleton width={150} height={44} radius={999} />
        </div>
      </div>
    </section>
  );
}

function GenreRow() {
  const navigate = useUi((s) => s.navigate);
  return (
    <section className={styles.block}>
      <header className={styles.blockHeader}>
        <h2>Жанры</h2>
        <button type="button" className={styles.more} onClick={() => navigate({ name: 'browse' })}>
          Все жанры <ChevronRight size={14} />
        </button>
      </header>
      <div className={styles.genres}>
        {POPULAR_GENRES.slice(0, 12).map((g) => {
          const Icon = genreIcon(g.tag);
          return (
            <button key={g.tag} type="button" className={styles.genre} onClick={() => navigate({ name: 'tag', param: g.tag })}>
              <span className={styles.genreIcon}>
                <Icon size={14} />
              </span>
              {g.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Главная: баннер — самый свежий релиз подписок (без подписок — первый трек «Популярного сейчас»),
 * «Моя волна» с чипами волн, затем «Новое от моих артистов» и «Свежее от похожих» (без подписок — подсказка «Подпишись на артистов»),
 * «Популярное сейчас» и жанры.
 */
export function HomeScreen() {
  useChartsInit();
  useFeedInit();
  const chart = useCharts((s) => s.chart);
  const chartsLoading = useCharts((s) => s.loading || (s.refreshing && s.updatedAt === null));
  const feedLoading = useFeed((s) => s.loading);
  const following = useLibrary((s) => s.lib.followedArtists.length > 0);
  const { hero: fresh } = useFeedView();
  const freshTracks = useReleaseTracks((s) => (fresh ? s.entries[fresh.id] : undefined));

  // Треки свежего релиза — заранее, чтобы «В плейлист» в баннере работал сразу.
  useEffect(() => {
    if (fresh) useReleaseTracks.getState().ensure(fresh.id, fresh.id);
  }, [fresh]);

  const hero = useMemo(() => {
    if (following && fresh) return releaseHero(fresh, freshTracks?.status === 'done' ? freshTracks.value : null);
    return chartHero(chart);
  }, [following, fresh, freshTracks, chart]);

  return (
    <>
      <ScreenHeader eyebrow={following ? 'Свежая музыка' : 'Что слушают сейчас'} title={following ? 'Для тебя' : 'В тренде'} />

      {hero ? <CatalogHero hero={hero} /> : chartsLoading || (following && feedLoading) ? <HeroSkeleton /> : null}

      <WaveBlock />

      {following ? (
        <>
          <FollowedFeedBlock limit={FEED_PREVIEW} />
          <SimilarFeedBlock limit={FEED_PREVIEW} />
        </>
      ) : (
        <FollowSuggestions />
      )}

      <ChartBlock />

      <GenreRow />
    </>
  );
}
