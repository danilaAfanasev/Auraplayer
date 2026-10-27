import type { NamesakeRef } from '../../../shared/types';
import { ArtistAvatar } from './ArtistAvatar';
import { openArtist } from './artistNav';
import styles from './Namesakes.module.css';

/**
 * Страница открыта по имени, а у каталога есть другие исполнители с точно таким же именем: переключатели
 * (фото, жанр) ведут на страницу выбранного по id.
 */
export function Namesakes({ name, namesakes }: { name: string; namesakes: readonly NamesakeRef[] }) {
  if (namesakes.length === 0) return null;
  return (
    <section className={styles.namesakes} aria-label="Другие исполнители с таким именем">
      <p className={styles.text}>Есть другие исполнители с именем «{name}»</p>
      <div className={styles.chips}>
        {namesakes.map((a) => (
          <button
            key={a.id}
            type="button"
            className={styles.chip}
            onClick={() => openArtist({ id: a.id })}
            title={a.genre ? `${a.name} · ${a.genre}` : a.name}
          >
            <ArtistAvatar name={a.name} imageUrl={a.imageUrl} size={40} />
            <span className={styles.label}>
              <span className={styles.name}>{a.name}</span>
              <span className={styles.genre}>{a.genre ?? 'Артист'}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
