import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

interface Props {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  className?: string;
}

/** Мерцающая заготовка на время загрузки. */
export function Skeleton({ width = '100%', height = 14, radius, circle = false, className }: Props) {
  const style: CSSProperties = { width, height, borderRadius: circle ? '50%' : radius };
  return <span className={[styles.skeleton, className].filter(Boolean).join(' ')} style={style} aria-hidden="true" />;
}

/** Заготовка списка треков: обложка, две строки текста, длительность. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className={styles.rows} role="status" aria-label="Загрузка">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.row} style={{ animationDelay: `${i * 40}ms` }}>
          <Skeleton width={40} height={40} radius={10} />
          <div className={styles.lines}>
            <Skeleton width={`${55 - (i % 3) * 8}%`} height={12} />
            <Skeleton width={`${35 - (i % 2) * 6}%`} height={10} />
          </div>
          <Skeleton width={36} height={10} />
        </div>
      ))}
    </div>
  );
}
