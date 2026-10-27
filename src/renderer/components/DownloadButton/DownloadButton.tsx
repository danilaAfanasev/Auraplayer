import { CircleCheck, Download, X } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import type { Track } from '../../../shared/types';
import { initDownloads, useDownloads, useDownloadView } from '../../stores/useDownloads';
import buttonStyles from '../Button/Button.module.css';
import styles from './DownloadButton.module.css';

interface Props {
  /** null — ничего не играет, кнопка неактивна. */
  track: Track | null;
  size?: 'small' | 'medium';
  /** Для своих файлов кнопки нет вовсе (в таблице) — иначе неактивная с подсказкой. */
  hideWhenLocal?: boolean;
}

const RING_R = 11;
const RING_LEN = 2 * Math.PI * RING_R;

/**
 * «Скачать»: клик — в очередь; во время загрузки — кольцо прогресса, повторный клик отменяет.
 * Скачанный трек — значок «скачано». Трек с запретом автора — неактивная кнопка с подсказкой.
 */
export function DownloadButton({ track, size = 'small', hideWhenLocal = false }: Props) {
  useEffect(() => {
    initDownloads();
  }, []);
  const view = useDownloadView(track?.id ?? null);
  const iconSize = size === 'small' ? 16 : 18;
  const base = [buttonStyles.iconButton, buttonStyles[size], styles.button].join(' ');

  if (track?.source === 'local' && hideWhenLocal) return null;

  let label: string;
  let blocked = false;
  if (!track) {
    label = 'Скачать';
  } else if (track.source === 'local') {
    label = 'Это твой файл — он уже на диске';
    blocked = true;
  } else if (view.kind === 'done') {
    label = 'Скачано — играет и без интернета';
  } else if (view.kind === 'queued') {
    label = 'В очереди на скачивание — нажми, чтобы отменить';
  } else if (view.kind === 'downloading') {
    label =
      view.progress >= 0
        ? `Скачивается ${Math.round(view.progress * 100)}% — нажми, чтобы отменить`
        : 'Скачивается — нажми, чтобы отменить';
  } else if (!track.downloadable) {
    label = 'Скачивание недоступно';
    blocked = true;
  } else {
    label = 'Скачать';
  }

  const onClick = () => {
    if (!track || blocked) return;
    const store = useDownloads.getState();
    if (view.kind === 'queued' || view.kind === 'downloading') store.cancel(track.id);
    else if (view.kind === 'none') store.start(track);
  };

  if (view.kind === 'queued' || view.kind === 'downloading') {
    const progress = view.kind === 'downloading' ? view.progress : -1;
    const indeterminate = progress < 0;
    return (
      <button
        type="button"
        className={[base, styles.busy].join(' ')}
        title={label}
        aria-label={label}
        onClick={onClick}
        style={{ '--ring-len': RING_LEN, '--ring-offset': indeterminate ? RING_LEN * 0.72 : RING_LEN * (1 - progress) } as CSSProperties}
      >
        <svg className={[styles.ring, indeterminate ? styles.spin : ''].join(' ')} viewBox="0 0 26 26" aria-hidden="true">
          <circle className={styles.track} cx="13" cy="13" r={RING_R} />
          <circle className={[styles.value, view.kind === 'queued' ? styles.queued : ''].join(' ')} cx="13" cy="13" r={RING_R} />
        </svg>
        <X size={iconSize - 4} strokeWidth={2.4} className={styles.cancel} />
      </button>
    );
  }

  const done = view.kind === 'done';
  return (
    <button
      type="button"
      className={[base, done ? styles.done : '', blocked ? styles.blocked : ''].join(' ')}
      title={label}
      aria-label={label}
      aria-disabled={!track || blocked || done || undefined}
      disabled={!track}
      onClick={onClick}
    >
      {done ? <CircleCheck size={iconSize} strokeWidth={2.2} /> : <Download size={iconSize} strokeWidth={2} />}
    </button>
  );
}
