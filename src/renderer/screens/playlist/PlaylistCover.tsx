import { Music } from 'lucide-react';
import type { Track } from '../../../shared/types';
import styles from './PlaylistCover.module.css';

const TILES = 4;

/** Обложка плейлиста: мозаика 2×2 из первых четырёх треков; у пустого — нотка на фоне темы. */
export function PlaylistCover({ tracks, className }: { tracks: Track[]; className?: string }) {
  const tiles = tracks.slice(0, TILES);
  return (
    <div className={[styles.cover, className].filter(Boolean).join(' ')} aria-hidden="true">
      {tiles.length === 0 ? (
        <div className={styles.empty}>
          <Music size={56} strokeWidth={1.4} />
        </div>
      ) : (
        Array.from({ length: TILES }, (_, i) => {
          const track = tiles[i];
          return (
            <div key={i} className={styles.tile}>
              {track?.coverUrl ? <img src={track.coverUrl} alt="" draggable={false} /> : <Music size={22} strokeWidth={1.6} />}
            </div>
          );
        })
      )}
    </div>
  );
}
