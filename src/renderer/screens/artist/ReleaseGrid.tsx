import { Disc3, LoaderCircle, Play } from 'lucide-react';
import { useState } from 'react';
import type { ArtistRelease } from '../../../shared/types';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { useNow } from '../../components/useNow';
import { playRelease, releaseArtists } from './artistData';
import { openAlbum } from './artistNav';
import { releaseDateLabel, releaseKindLabel } from './releaseFormat';
import styles from './ReleaseGrid.module.css';

interface Props {
  releases: ArtistRelease[];
  /** Страница этого артиста уже открыта — его имя под релизом не ссылка. */
  currentArtist?: string;
}

function ReleaseCard({ release, currentArtist }: { release: ArtistRelease; currentArtist?: string }) {
  const now = useNow();
  const [loading, setLoading] = useState(false);
  const play = async () => {
    setLoading(true);
    try {
      await playRelease(release);
    } finally {
      setLoading(false);
    }
  };
  const meta = [releaseKindLabel(release.kind), releaseDateLabel(release.releaseDate, now)].filter(Boolean).join(' · ');
  const open = () => openAlbum(release.id);

  return (
    <div className={styles.card} role="listitem">
      <div className={styles.cover}>
        <button
          type="button"
          className={styles.coverOpen}
          onClick={open}
          aria-label={`Открыть «${release.title}» — ${release.artist}`}
          title={`${release.artist} — ${release.title}`}
        >
          {release.coverUrl ? <img src={release.coverUrl} alt="" loading="lazy" draggable={false} /> : <Disc3 size={40} strokeWidth={1.4} />}
        </button>
        <button
          type="button"
          className={[styles.play, loading ? styles.playVisible : ''].join(' ')}
          onClick={() => void play()}
          aria-label={`Слушать «${release.title}»`}
          title="Слушать"
        >
          {loading ? <LoaderCircle size={22} className="spin" /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
        </button>
      </div>
      <button type="button" className={styles.title} onClick={open} title={release.title}>
        {release.title}
      </button>
      <ArtistLinks
        artist={release.artist}
        title={release.title}
        except={currentArtist}
        known={releaseArtists(release)}
        className={styles.artist}
      />
      <div className={styles.meta}>{meta}</div>
      {release.similarTo && <div className={styles.note}>похож на {release.similarTo.name}</div>}
    </div>
  );
}

/** Сетка релизов: обложка и название (клик — страница альбома, «играть» на обложке — слушать), исполнители ссылками, вид и дата. */
export function ReleaseGrid({ releases, currentArtist }: Props) {
  return (
    <div className={styles.grid} role="list">
      {releases.map((r) => (
        <ReleaseCard key={r.id} release={r} currentArtist={currentArtist} />
      ))}
    </div>
  );
}
