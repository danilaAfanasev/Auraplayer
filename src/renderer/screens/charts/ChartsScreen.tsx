import { RotateCw, TrendingUp } from 'lucide-react';
import { CHART_COUNTRIES } from '../../../shared/types';
import { PlayButtons } from '../../components/PlayButtons/PlayButtons';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { usePlayer } from '../../stores/usePlayer';
import { ChartsStatus } from './ChartsStatus';
import styles from './ChartsScreen.module.css';
import { useCharts, useChartsInit } from './useCharts';

/** Заголовок экрана и очереди, которую он включает. */
const CHART_TITLE = 'Популярное сейчас';

/** «Популярное сейчас»: топ песен открытого чарта выбранной страны; номер строки — позиция в чарте. */
export function ChartsScreen() {
  useChartsInit();
  const chart = useCharts((s) => s.chart);
  const loading = useCharts((s) => s.loading || (s.refreshing && s.updatedAt === null));
  const error = useCharts((s) => s.error);
  const updatedAt = useCharts((s) => s.updatedAt);
  const refresh = useCharts((s) => s.refresh);
  const country = useCharts((s) => s.country);
  const countryName = CHART_COUNTRIES.find((c) => c.code === country)?.name;

  return (
    <>
      <ScreenHeader
        eyebrow={chart.length > 0 ? `Топ-${chart.length}${countryName ? ` · ${countryName}` : ''}` : 'Чарт'}
        title={CHART_TITLE}
        aside={
          chart.length > 0 && (
            <PlayButtons tracks={chart} title={CHART_TITLE} />
          )
        }
      />
      <div className={styles.bar}>
        <span className={styles.note}>
          {countryName ? `Что слушают сейчас: ${countryName}` : 'Что слушают прямо сейчас'} — по открытому чарту; страну можно сменить в настройках
        </span>
        <ChartsStatus />
      </div>

      {loading && chart.length === 0 ? (
        <SkeletonRows count={10} />
      ) : chart.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title={error?.kind === 'offline' && updatedAt === null ? 'Нет соединения' : 'Чарт пока не загрузился'}
          text="Попробуй обновить чуть позже."
          action={{ label: 'Обновить', icon: RotateCw, onClick: () => void refresh() }}
        />
      ) : (
        <TrackTable tracks={chart} onPlay={(i) => usePlayer.getState().playList(chart, i, CHART_TITLE)} />
      )}
    </>
  );
}
