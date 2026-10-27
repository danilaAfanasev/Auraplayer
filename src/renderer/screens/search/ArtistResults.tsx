// Карточки артистов над результатами поиска: «Juice WRLD», «SALUKI», «madk1d» — первой идёт сам артист.
// Артист из чёрного списка не прячется, а приглушён: пометка и «Вернуть» вместо «Подписаться».
import { ChevronRight, Undo2 } from 'lucide-react';
import { useEffect } from 'react';
import { artistKey } from '../../../shared/artistNames';
import { isArtistBlocked } from '../../../shared/blacklist';
import { Button } from '../../components/Button/Button';
import { restoreArtist, useBlacklist } from '../../stores/blacklistActions';
import { ArtistAvatar } from '../artist/ArtistAvatar';
import { useArtistSearch } from '../artist/artistData';
import { openArtist } from '../artist/artistNav';
import { FollowButton } from '../artist/FollowButton';
import followStyles from '../artist/FollowButton.module.css';
import styles from './ArtistResults.module.css';

export function ArtistResults({ query }: { query: string }) {
  const entry = useArtistSearch((s) => s.entries[query]);
  const blacklist = useBlacklist();

  useEffect(() => {
    if (query) useArtistSearch.getState().ensure(query, query);
  }, [query]);

  if (!query || entry?.status !== 'done' || entry.value.length === 0) return null;

  return (
    <section className={styles.list} aria-label="Артисты">
      {entry.value.map((a, i) => {
        const blocked = isArtistBlocked(a.name, blacklist);
        return (
          <div key={a.id} className={[styles.card, i === 0 ? styles.top : ''].join(' ')}>
            <button
              type="button"
              className={styles.main}
              style={blocked ? { opacity: 0.45 } : undefined}
              onClick={() => openArtist({ id: a.id })}
              title={`Открыть ${a.name}`}
            >
              <ArtistAvatar name={a.name} imageUrl={a.imageUrl} size={i === 0 ? 88 : 56} />
              <span className={styles.meta}>
                <span className={styles.label}>{blocked ? 'Артист · в чёрном списке' : 'Артист'}</span>
                <span className={styles.name}>{a.name}</span>
              </span>
              <ChevronRight size={18} className={styles.chevron} />
            </button>
            {blocked ? (
              <Button variant="outline" icon={Undo2} className={followStyles.small} title={`Вернуть ${a.name} из чёрного списка`} onClick={() => restoreArtist(artistKey(a.name))}>
                Вернуть
              </Button>
            ) : (
              <FollowButton artist={a} small />
            )}
          </div>
        );
      })}
    </section>
  );
}
