import { MicVocal } from 'lucide-react';
import styles from './ArtistAvatar.module.css';

/** Круглое фото артиста; без фото — первая буква имени на акцентном фоне. */
export function ArtistAvatar({ name, imageUrl, size = 120 }: { name: string; imageUrl?: string; size?: number }) {
  const letter = name.trim().charAt(0).toUpperCase();
  return (
    <span className={styles.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" draggable={false} />
      ) : letter ? (
        letter
      ) : (
        <MicVocal size={Math.round(size * 0.4)} />
      )}
    </span>
  );
}
