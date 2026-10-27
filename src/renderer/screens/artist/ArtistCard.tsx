import type { ReactNode } from 'react';
import { ArtistAvatar } from './ArtistAvatar';
import styles from './ArtistCard.module.css';
import { openArtistByName } from './artistData';
import { openArtist } from './artistNav';

interface Props {
  /** Без `id` (похожий артист) — страница по точному имени в каталоге, нет такого — поиск по имени. */
  artist: { id?: string; name: string; imageUrl?: string };
  subtitle?: string;
  /** Под карточкой: например, «Подписаться». */
  action?: ReactNode;
}

/** Карточка артиста: круглое фото и имя; клик — страница артиста. */
export function ArtistCard({ artist, subtitle = 'Артист', action }: Props) {
  return (
    <div className={styles.card} role="listitem">
      <button
        type="button"
        className={styles.main}
        onClick={() => (artist.id ? openArtist({ id: artist.id }) : void openArtistByName(artist.name))}
        title={artist.name}
      >
        <span className={styles.photo}>
          <ArtistAvatar name={artist.name} imageUrl={artist.imageUrl} size={132} />
        </span>
        <span className={styles.name}>{artist.name}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </button>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

/** Сетка карточек артистов. */
export function ArtistRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className={styles.row} role="list" aria-label={label}>
      {children}
    </div>
  );
}
