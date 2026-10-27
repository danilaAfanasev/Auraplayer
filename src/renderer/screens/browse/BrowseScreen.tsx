import type { CSSProperties } from 'react';
import { GENRES } from '../../../shared/genres';
import { genreIcon } from '../../components/GenreIcon/genreIcon';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { useUi } from '../../stores/useUi';
import styles from './BrowseScreen.module.css';

/** «Обзор»: сетка карточек жанров в оттенках темы; клик — подборка жанра. */
export function BrowseScreen() {
  const navigate = useUi((s) => s.navigate);
  return (
    <>
      <ScreenHeader eyebrow="Жанры и настроения" title="Обзор" />
      <div className={styles.grid}>
        {GENRES.map((g, i) => {
          const Icon = genreIcon(g.tag);
          // Сдвиг оттенка акцента и глубина — у каждой карточки свои, но все из цветов темы.
          const style = { '--hue-shift': ((i * 23) % 70) - 35, '--depth': `${55 + ((i * 13) % 30)}%`, '--i': i } as CSSProperties;
          return (
            <button
              key={g.tag}
              type="button"
              className={styles.card}
              style={style}
              onClick={() => navigate({ name: 'tag', param: g.tag })}
            >
              <span className={styles.name}>{g.name}</span>
              <Icon className={styles.icon} size={64} strokeWidth={1.6} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </>
  );
}
