import { useId } from 'react';
import styles from './AuraLogo.module.css';

interface Props {
  /** Показывать надпись «Aura» рядом со знаком. */
  withWordmark?: boolean;
  size?: number;
}

/** Знак Aura: звуковая волна внутри мягкого кольца-«ауры». Цвета — из темы. */
export function AuraLogo({ withWordmark = true, size = 34 }: Props) {
  const id = useId();
  const ring = `${id}-ring`;
  const glow = `${id}-glow`;
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-text)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle cx="32" cy="32" r="25" fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="6" filter={`url(#${glow})`} />
        <circle cx="32" cy="32" r="24" fill="none" stroke={`url(#${ring})`} strokeWidth="4" />
        <g fill="var(--text)">
          <rect x="20.5" y="27.5" width="4" height="9" rx="2" />
          <rect x="26.5" y="22.5" width="4" height="19" rx="2" />
          <rect x="32.5" y="20" width="4" height="24" rx="2" />
          <rect x="38.5" y="25.5" width="4" height="13" rx="2" />
        </g>
      </svg>
      {withWordmark && <span className={styles.wordmark}>Aura</span>}
    </span>
  );
}
