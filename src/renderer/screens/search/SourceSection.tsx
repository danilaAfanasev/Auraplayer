import { ChevronRight, CircleAlert, Download, Power, RotateCw, SearchX, WifiOff, type LucideIcon } from 'lucide-react';
import { SOURCE_NAMES, type SourceErrorKind, type SourceId } from '../../../shared/types';
import { Button } from '../../components/Button/Button';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { usePlayer } from '../../stores/usePlayer';
import type { SourceStatus } from './sourceQueries';
import styles from './SourceSection.module.css';
import { useYtDlpProgress, ytDlpProgressText } from './ytdlpProgress';

const ERROR_ICONS: Partial<Record<SourceErrorKind, LucideIcon>> = {
  offline: WifiOff,
  disabled: Power,
};

/** Состояние ошибки источника: свой текст, «Повторить». */
export function SourceError({
  kind,
  message,
  onRetry,
}: {
  kind: SourceErrorKind;
  message: string;
  onRetry?: () => void;
}) {
  const Icon = ERROR_ICONS[kind] ?? CircleAlert;
  return (
    <div className={styles.notice} role="status">
      <Icon size={18} className={styles.noticeIcon} />
      <span className={styles.noticeText}>{message}</span>
      {onRetry && kind !== 'disabled' && (
        <Button variant="outline" icon={RotateCw} onClick={onRetry} className={styles.retry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

/** Первый запрос к YouTube или SoundCloud скачивает yt-dlp — показываем, сколько осталось. */
function YtDlpPreparing() {
  const progress = useYtDlpProgress();
  if (!progress) return null;
  return (
    <div className={[styles.notice, styles.preparing].join(' ')} role="status">
      <Download size={18} className={styles.noticeIcon} />
      <span className={styles.noticeText}>{ytDlpProgressText(progress)}</span>
    </div>
  );
}

interface Props {
  source: SourceId;
  status: SourceStatus | undefined;
  /** Текст, если источник ответил пустым списком. */
  emptyText: string;
  onRetry(): void;
  /** Показать не больше N треков (очередь всё равно — весь список источника). */
  limit?: number;
  /** Заголовок с названием источника и счётчиком. */
  withTitle?: boolean;
  onShowAll?: () => void;
  /** Заголовок очереди, которую включает строка (имя списка: «Поиск: «…»», жанр). */
  queueTitle?: string;
}

/** Результат одного источника: скелетон, ошибка с «Повторить», «ничего не нашлось» или таблица. */
export function SourceSection({ source, status, emptyText, onRetry, limit, withTitle = false, onShowAll, queueTitle }: Props) {
  const tracks = status?.status === 'done' ? status.result.tracks : [];
  const shown = limit ? tracks.slice(0, limit) : tracks;
  const play = (index: number) => usePlayer.getState().playList(tracks, index, queueTitle);

  let body;
  if (!status || status.status === 'loading') {
    body = (
      <>
        {(source === 'youtube' || source === 'soundcloud') && <YtDlpPreparing />}
        <SkeletonRows count={limit ? Math.min(limit, 4) : 6} />
      </>
    );
  } else if (status.result.error) {
    body = <SourceError kind={status.result.error.kind} message={status.result.error.message} onRetry={onRetry} />;
  } else if (tracks.length === 0) {
    body = (
      <div className={styles.notice}>
        <SearchX size={18} className={styles.noticeIcon} />
        <span className={styles.noticeText}>{emptyText}</span>
      </div>
    );
  } else {
    body = <TrackTable tracks={shown} onPlay={play} hideHeader={withTitle} />;
  }

  return (
    <section className={styles.section}>
      {withTitle && (
        <header className={styles.header}>
          <h2>{SOURCE_NAMES[source]}</h2>
          {tracks.length > 0 && <span className={styles.count}>{tracks.length}</span>}
          {onShowAll && limit && tracks.length > limit && (
            <button type="button" className={styles.more} onClick={onShowAll}>
              Все <ChevronRight size={14} />
            </button>
          )}
        </header>
      )}
      {body}
    </section>
  );
}
