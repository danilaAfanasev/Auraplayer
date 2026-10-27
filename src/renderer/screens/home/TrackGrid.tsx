import { Music, Play } from 'lucide-react';
import { formatDuration } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { Equalizer } from '../../components/TrackTable/TrackTable';
import { usePlayer } from '../../stores/usePlayer';
import styles from './TrackGrid.module.css';

export interface GridItem {
  track: Track;
  /** Подпись после исполнителя (например, дата выхода). */
  note?: string;
}

interface Props {
  items: GridItem[];
  onPlay(index: number): void;
  /** Показывать позицию в чарте (1…N) перед обложкой. */
  positions?: boolean;
}

/**
 * Компактная сетка треков в две колонки для блоков главной: обложка, название, исполнитель, ♥, длительность.
 * Клик по строке — играть, по имени исполнителя — его страница; у играющего трека на обложке эквалайзер.
 */
export function TrackGrid({ items, onPlay, positions = false }: Props) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.isPlaying || s.isLoading);

  return (
    <div className={styles.grid} role="list">
      {items.map(({ track, note }, i) => {
        const current = track.id === currentId;
        return (
          <div key={track.id} role="listitem" className={[styles.item, current ? styles.current : ''].join(' ')}>
            <div
              role="button"
              tabIndex={0}
              className={styles.main}
              onClick={() => onPlay(i)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                onPlay(i);
              }}
              aria-label={`Играть «${track.title}» — ${track.artist}`}
              title={`${track.artist} — ${track.title}`}
            >
              {positions && <span className={styles.position}>{i + 1}</span>}
              <span className={styles.cover}>
                {track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy" draggable={false} /> : <Music size={18} />}
                <span className={styles.coverOverlay} aria-hidden="true">
                  {current ? <Equalizer playing={playing} /> : <Play size={16} fill="currentColor" strokeWidth={0} />}
                </span>
              </span>
              <span className={styles.meta}>
                <span className={styles.title}>{track.title}</span>
                <span className={styles.artist}>
                  <ArtistLinks artist={track.artist} title={track.title} />
                  {note && <span className={styles.note}> · {note}</span>}
                </span>
              </span>
            </div>
            <LikeButton track={track} />
            <span className={styles.time}>{formatDuration(track.durationSec)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Заглушка сетки на время загрузки. */
export function TrackGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={styles.grid} aria-label="Загрузка">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.item}>
          <Skeleton width={48} height={48} radius={10} />
          <span className={styles.meta}>
            <Skeleton width="60%" height={13} />
            <Skeleton width="35%" height={11} />
          </span>
        </div>
      ))}
    </div>
  );
}
