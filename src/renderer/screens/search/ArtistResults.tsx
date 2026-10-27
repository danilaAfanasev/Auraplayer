// Карточки артистов над результатами поиска (6–8): свои артисты первыми, затем по популярности («kanye» → Kanye West).
// Карточка без id каталога (артист нашёлся по популярности) открывает страницу по точному имени — id ищется при клике.
// Артист из чёрного списка не прячется, а приглушён: пометка и «Вернуть» вместо «Подписаться».
import { ChevronRight, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { artistKey } from '../../../shared/artistNames';
import { isArtistBlocked } from '../../../shared/blacklist';
import type { ArtistCard } from '../../../shared/types';
import { Button } from '../../components/Button/Button';
import { restoreArtist, useBlacklist } from '../../stores/blacklistActions';
import { ArtistAvatar } from '../artist/ArtistAvatar';
import { openArtistByName, useArtistSearch } from '../artist/artistData';
import { openArtist } from '../artist/artistNav';
import { FollowButton } from '../artist/FollowButton';
import followStyles from '../artist/FollowButton.module.css';
import styles from './ArtistResults.module.css';

export function ArtistResults({ query }: { query: string }) {
  const entry = useArtistSearch((s) => s.entries[query]);
  const blacklist = useBlacklist();
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (query) useArtistSearch.getState().ensure(query, query);
  }, [query]);

  if (!query || entry?.status !== 'done' || entry.value.length === 0) return null;

  const open = (a: ArtistCard) => {
    if (a.id) {
      openArtist({ id: a.id });
      return;
    }
    // id каталога ещё не известен — ищется сейчас, по точному имени (не тёзка).
    if (opening) return;
    setOpening(a.name);
    void openArtistByName(a.name).finally(() => setOpening(null));
  };

  return (
    <section className={styles.list} aria-label="Артисты">
      {entry.value.map((a, i) => {
        const blocked = isArtistBlocked(a.name, blacklist);
        return (
          <div key={a.id ?? `name:${artistKey(a.name)}`} className={[styles.card, i === 0 ? styles.top : ''].join(' ')}>
            <button
              type="button"
              className={styles.main}
              style={blocked ? { opacity: 0.45 } : undefined}
              aria-busy={opening === a.name || undefined}
              onClick={() => open(a)}
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
              // «Подписаться» — у первой карточки; остальные компактные (подписка — на странице артиста).
              a.id && i === 0 && <FollowButton artist={{ id: a.id, name: a.name, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) }} small />
            )}
          </div>
        );
      })}
    </section>
  );
}
