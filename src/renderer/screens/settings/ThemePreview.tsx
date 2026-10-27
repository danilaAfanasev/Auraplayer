import { useMemo, type CSSProperties } from 'react';
import { buildPalette } from '../../../shared/palette';
import styles from './ThemePreview.module.css';

interface Props {
  accent: string;
  background: string;
  /** Крупный вариант для блока «Свои цвета». */
  large?: boolean;
}

/** Живое превью темы: мини-окно, раскрашенное палитрой из `buildPalette` (не зависит от текущей темы). */
export function ThemePreview({ accent, background, large = false }: Props) {
  const style = useMemo(() => {
    const p = buildPalette(accent, background);
    return {
      '--pv-bg': p['--bg'],
      '--pv-glow': p['--bg-glow'],
      '--pv-deep': p['--bg-deep'],
      '--pv-card': p['--card'],
      '--pv-text': p['--text'],
      '--pv-muted': p['--text-faint'],
      '--pv-surface': p['--surface-2'],
      '--pv-accent': p['--accent'],
      '--pv-accent-contrast': p['--accent-contrast'],
    } as CSSProperties;
  }, [accent, background]);

  return (
    <div className={[styles.preview, large ? styles.large : ''].filter(Boolean).join(' ')} style={style} aria-hidden="true">
      <div className={styles.window}>
        <div className={styles.side}>
          <span className={styles.dot} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </div>
        <div className={styles.main}>
          <span className={styles.title} />
          <span className={styles.line} />
          <span className={`${styles.line} ${styles.short}`} />
          <span className={styles.play}>
            <span className={styles.triangle} />
          </span>
        </div>
      </div>
    </div>
  );
}
