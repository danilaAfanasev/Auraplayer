// Блок главной «Популярное сейчас» (чарт выбранной страны, звук — с YouTube).
import { ChevronRight, RotateCw, TrendingUp, WifiOff, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { CHART_COUNTRIES } from '../../../shared/types';
import { Button } from '../../components/Button/Button';
import { usePlayer } from '../../stores/usePlayer';
import { useUi, type ScreenName } from '../../stores/useUi';
import { ChartsStatus } from '../charts/ChartsStatus';
import { useCharts, useChartsInit } from '../charts/useCharts';
import styles from './CatalogBlocks.module.css';
import { TrackGrid, TrackGridSkeleton } from './TrackGrid';

const CHART_PREVIEW = 10;

function BlockHeader({
  icon: Icon,
  title,
  subtitle,
  target,
  status = false,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  target: ScreenName;
  /** «Обновлено N мин назад» и «Обновить». */
  status?: boolean;
}) {
  const navigate = useUi((s) => s.navigate);
  return (
    <header className={styles.header}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={22} strokeWidth={2.2} />
      </span>
      <div className={styles.heading}>
        <button type="button" className={styles.title} onClick={() => navigate({ name: target })}>
          {title}
          <ChevronRight size={20} strokeWidth={2.6} />
        </button>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>
      <div className={styles.aside}>
        {status && (
          <span className={styles.statusSlot}>
            <ChartsStatus compact />
          </span>
        )}
        <button type="button" className={styles.more} onClick={() => navigate({ name: target })}>
          Все <ChevronRight size={14} />
        </button>
      </div>
    </header>
  );
}

/** Нет данных и обновление не удалось. */
function Failed() {
  const error = useCharts((s) => s.error);
  const refresh = useCharts((s) => s.refresh);
  return (
    <div className={styles.notice} role="status">
      <WifiOff size={18} />
      <span>{error?.kind === 'offline' ? 'Нет соединения — списки появятся, когда вернётся интернет' : 'Не удалось загрузить списки'}</span>
      <Button variant="ghost" icon={RotateCw} onClick={() => void refresh()}>
        Повторить
      </Button>
    </div>
  );
}

export function ChartBlock() {
  useChartsInit();
  const chart = useCharts((s) => s.chart);
  const loading = useCharts((s) => s.loading || (s.refreshing && s.updatedAt === null));
  const failed = useCharts((s) => !!s.error && s.updatedAt === null);
  const top = useMemo(() => chart.slice(0, CHART_PREVIEW), [chart]);
  const country = useCharts((s) => s.country);
  const countryName = CHART_COUNTRIES.find((c) => c.code === country)?.name;

  return (
    <section className={styles.block}>
      <BlockHeader icon={TrendingUp} title={countryName ? `Популярное сейчас — ${countryName}` : 'Популярное сейчас'} subtitle="Что слушают прямо сейчас" target="charts" status />
      {loading && top.length === 0 ? (
        <TrackGridSkeleton count={CHART_PREVIEW} />
      ) : failed && top.length === 0 ? (
        <Failed />
      ) : (
        <TrackGrid items={top.map((track) => ({ track }))} positions onPlay={(i) => usePlayer.getState().playList(chart, i, 'Популярное сейчас')} />
      )}
    </section>
  );
}
