import styles from './Update.module.css';

/** «Скачиваю обновление… 45%» и полоска хода; -1 — размер неизвестен (полоска бежит). */
export function UpdateProgress({ progress, compact = false }: { progress: number; compact?: boolean }) {
  const known = progress >= 0;
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className={[styles.progress, compact ? styles.progressCompact : ''].join(' ')} role="status" aria-live="polite">
      <span className={styles.progressText}>Скачиваю обновление…{known ? ` ${percent}%` : ''}</span>
      <div className={styles.track}>
        <div className={[styles.fill, known ? '' : styles.indeterminate].join(' ')} style={known ? { width: `${percent}%` } : undefined} />
      </div>
    </div>
  );
}
