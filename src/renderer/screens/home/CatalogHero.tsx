// Баннер-герой наверху главной (как в референсе): релиз или трек на крупной обложке поверх размытого фона —
// подпись, название, исполнитель, плашка (позиция в чарте или дата выхода), «Слушать» и «В плейлист».
import { CalendarDays, ListPlus, LoaderCircle, Music, Play, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { AddToPlaylistMenu } from '../../components/AddToPlaylistMenu/AddToPlaylistMenu';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { Button } from '../../components/Button/Button';
import { usePlayer } from '../../stores/usePlayer';
import { playRelease, releaseArtists } from '../artist/artistData';
import { openAlbum } from '../artist/artistNav';
import styles from './CatalogHero.module.css';
import type { HeroRelease } from './heroRelease';

const CHART_TITLE = 'Популярное сейчас';

export function CatalogHero({ hero }: { hero: HeroRelease }) {
  const album = hero.album && hero.album.toLowerCase() !== hero.title.toLowerCase() ? hero.album : undefined;
  const [starting, setStarting] = useState(false);
  const StatIcon = hero.stat.kind === 'chart' ? TrendingUp : CalendarDays;
  const release = hero.release;

  const listen = async () => {
    if (hero.queue.length > 0) {
      // Заголовок очереди: релиз или чарт (баннер без релиза — первый трек чарта).
      usePlayer.getState().playList(hero.queue, hero.start, release ? release.title : CHART_TITLE);
      return;
    }
    if (!hero.release) return;
    setStarting(true);
    try {
      await playRelease(hero.release);
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className={styles.hero} aria-label={`${hero.title} — ${hero.artist}`}>
      {hero.coverUrl && <img className={styles.blur} src={hero.coverUrl} alt="" aria-hidden="true" draggable={false} />}
      <div className={styles.art} aria-hidden="true">
        {hero.coverUrl ? <img src={hero.coverUrl} alt="" draggable={false} /> : <Music size={72} strokeWidth={1.3} />}
      </div>
      <div className={styles.shade} aria-hidden="true" />

      {hero.stat.value && (
        <div className={styles.stat}>
          <span className={styles.statLabel}>{hero.stat.label}</span>
          <span className={styles.statValue}>
            <StatIcon size={16} strokeWidth={2.4} />
            {hero.stat.value}
          </span>
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.eyebrow}>{hero.eyebrow}</div>
        <h2 className={styles.title} title={hero.title}>
          {release ? (
            <span
              role="link"
              tabIndex={0}
              className={styles.titleLink}
              aria-label={`Открыть «${hero.title}»`}
              onClick={() => openAlbum(release.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                openAlbum(release.id);
              }}
            >
              {hero.title}
            </span>
          ) : (
            hero.title
          )}
        </h2>
        <p className={styles.artist}>
          <ArtistLinks artist={hero.artist} title={hero.title} known={release ? releaseArtists(release) : undefined} />
          {album && <span className={styles.album}> · {album}</span>}
        </p>
        <div className={styles.actions}>
          <Button icon={starting ? LoaderCircle : Play} className={starting ? 'spin-inner' : undefined} disabled={starting} onClick={() => void listen()}>
            Слушать
          </Button>
          <AddToPlaylistMenu
            tracks={hero.tracks}
            renderTrigger={({ open, toggle }) => (
              <Button
                variant="outline"
                icon={ListPlus}
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={hero.tracks.length === 0}
                onClick={toggle}
              >
                В плейлист
              </Button>
            )}
          />
        </div>
      </div>
    </section>
  );
}
