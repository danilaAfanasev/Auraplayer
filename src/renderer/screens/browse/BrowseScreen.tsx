import type { CSSProperties } from 'react';
import { GENRE_GROUPS, GENRES } from '../../../shared/genres';
import { genreIcon } from '../../components/GenreIcon/genreIcon';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { useUi } from '../../stores/useUi';
import styles from './BrowseScreen.module.css';

/** «Обзор»: жанры группами («Рэп и хип-хоп», «Электроника»…) — карточки в оттенках темы; клик — страница жанра. */
export function BrowseScreen() {
  const navigate = useUi((s) => s.navigate);
  let index = 0;
  return (
    <>
      <ScreenHeader eyebrow="Жанры и сцены" title="Обзор" />
      {GENRE_GROUPS.map((group) => {
        const genres = GENRES.filter((g) => g.group === group.id);
        if (genres.length === 0) return null;
        return (
          <section key={group.id} className={styles.group} aria-labelledby={`browse-${group.id}`}>
            <h2 id={`browse-${group.id}`} className={styles.groupTitle}>
              {group.name}
            </h2>
            <div className={styles.grid}>
              {genres.map((g) => {
                const i = index++;
                const Icon = genreIcon(g.tag);
                // Сдвиг оттенка акцента и глубина — у каждой карточки свои, но все из цветов темы.
                const style = { '--hue-shift': ((i * 23) % 70) - 35, '--depth': `${55 + ((i * 13) % 30)}%`, '--i': Math.min(i, 24) } as CSSProperties;
                return (
                  <button
                    key={g.tag}
                    type="button"
                    className={styles.card}
                    style={style}
                    onClick={() => navigate({ name: 'tag', param: g.tag })}
                  >
                    <span className={styles.name}>{g.name}</span>
                    <Icon className={styles.icon} size={56} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
