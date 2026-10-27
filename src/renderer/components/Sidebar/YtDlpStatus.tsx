import { CircleAlert, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyInstallEvent, installStatusText, phaseFromStatus, type InstallPhase } from './installText';
import styles from './YtDlpStatus.module.css';

/**
 * Тонкая полоска внизу сайдбара: пока main в фоне скачивает yt-dlp (первый запуск), показывает ход;
 * при ошибке сети — «Не удалось скачать компоненты» и «Повторить». Готово — полоска исчезает.
 */
export function YtDlpStatus({ collapsed = false }: { collapsed?: boolean }) {
  const [phase, setPhase] = useState<InstallPhase>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    const off = window.aura.ytdlp.onProgress((p) => setPhase((cur) => applyInstallEvent(cur, p)));
    // Установка могла начаться, пока окно грузилось: события оно пропустило — спрашиваем состояние.
    window.aura.ytdlp
      .status()
      .then((s) => {
        if (alive) setPhase((cur) => (cur.kind === 'idle' ? phaseFromStatus(s) : cur));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const retry = (): void => {
    setPhase({ kind: 'running', progress: -1 });
    window.aura.ytdlp.install().catch(() => setPhase({ kind: 'failed' }));
  };

  if (phase.kind === 'idle') return null;

  if (phase.kind === 'failed') {
    return (
      <div className={[styles.root, styles.failed, collapsed ? styles.compact : ''].join(' ')} role="status" title="Не удалось скачать компоненты">
        <CircleAlert size={16} className={styles.icon} />
        <span className={styles.text}>Не удалось скачать компоненты</span>
        <button type="button" className={styles.retry} title="Повторить" onClick={retry}>
          <RefreshCw size={13} strokeWidth={2.4} />
          <span className={styles.retryLabel}>Повторить</span>
        </button>
      </div>
    );
  }

  const text = installStatusText(phase.progress);
  const known = phase.progress >= 0;
  return (
    <div className={[styles.root, collapsed ? styles.compact : ''].join(' ')} role="status" aria-live="polite" title={text}>
      <span className={styles.text}>{text}</span>
      <div className={styles.track}>
        <div
          className={[styles.fill, known ? '' : styles.indeterminate].join(' ')}
          style={known ? { width: `${Math.round(Math.min(1, phase.progress) * 100)}%` } : undefined}
        />
      </div>
    </div>
  );
}
