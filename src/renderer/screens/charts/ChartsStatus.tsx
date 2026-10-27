import { LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import { timeAgo } from '../../../shared/format';
import { IconButton } from '../../components/Button/Button';
import { useNow } from '../../components/useNow';
import styles from './ChartsStatus.module.css';
import { useCharts } from './useCharts';

/** «Обновлено N мин назад» · «Нет соединения» · кнопка «Обновить». */
export function ChartsStatus({ compact = false }: { compact?: boolean }) {
  const updatedAt = useCharts((s) => s.updatedAt);
  const refreshing = useCharts((s) => s.refreshing);
  const error = useCharts((s) => s.error);
  const refresh = useCharts((s) => s.refresh);
  const now = useNow();

  return (
    <div className={[styles.status, compact ? styles.compact : ''].join(' ')}>
      {error && !refreshing && (
        <span className={styles.offline} role="status" title={error.message}>
          <WifiOff size={13} strokeWidth={2.4} />
          {error.kind === 'offline' ? 'Нет соединения' : 'Не обновилось'}
        </span>
      )}
      <span className={styles.updated}>
        {refreshing ? (
          <>
            <LoaderCircle size={13} className="spin" /> Обновляется…
          </>
        ) : updatedAt ? (
          `Обновлено ${timeAgo(updatedAt, Math.max(now, updatedAt))}`
        ) : (
          'Ещё не обновлялось'
        )}
      </span>
      <IconButton icon={RefreshCw} size="small" label="Обновить" title="Обновить" disabled={refreshing} onClick={() => void refresh()} />
    </div>
  );
}
