// Подсказка «Подпишись на артистов»: исполнители «Популярного сейчас» своей страны (без скрытых), у каждого
// «Подписаться», и «Подписаться на всех» — один клик, и лента с похожими заполняются. Зашитых артистов нет.
import { RotateCw, Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { isArtistBlocked } from '../../../shared/blacklist';
import { Button } from '../../components/Button/Button';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { useBlacklist } from '../../stores/blacklistActions';
import { useLibrary } from '../../stores/useLibrary';
import { useUi } from '../../stores/useUi';
import { ArtistCard, ArtistRow } from '../artist/ArtistCard';
import { usePopularArtists } from '../artist/artistData';
import { FollowButton } from '../artist/FollowButton';
import styles from './FollowSuggestions.module.css';

const KEY = 'popular';
const SHOWN = 8;

export function FollowSuggestions() {
  const entry = usePopularArtists((s) => s.entries[KEY]);
  const followed = useLibrary((s) => s.lib.followedArtists);
  const blacklist = useBlacklist();
  const navigate = useUi((s) => s.navigate);

  useEffect(() => {
    usePopularArtists.getState().ensure(KEY, undefined);
  }, []);

  const artists = useMemo(
    () => (entry?.status === 'done' ? entry.value.filter((a) => !isArtistBlocked(a.name, blacklist)).slice(0, SHOWN) : []),
    [entry, blacklist],
  );
  const ids = useMemo(() => new Set(followed.map((a) => a.id)), [followed]);
  const allFollowed = artists.length === 0 || artists.every((a) => ids.has(a.id));

  return (
    <section className={styles.box} aria-label="Подпишись на артистов">
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          <Users size={22} strokeWidth={2.2} />
        </span>
        <div className={styles.heading}>
          <h2>Подпишись на артистов</h2>
          <p>Их свежие релизы и новые исполнители того же круга появятся здесь. Начни с популярных сейчас или найди своих в поиске.</p>
        </div>
        <div className={styles.actions}>
          <Button icon={UserPlus} disabled={allFollowed} onClick={() => useLibrary.getState().followMany(artists)}>
            Подписаться на всех
          </Button>
          <Button variant="ghost" icon={Search} onClick={() => navigate({ name: 'search' })}>
            Найти в поиске
          </Button>
        </div>
      </header>
      {entry?.status === 'error' ? (
        <div className={styles.status}>
          <span>Не удалось загрузить популярных артистов — найди своих в поиске</span>
          <Button variant="ghost" icon={RotateCw} onClick={() => usePopularArtists.getState().retry(KEY, undefined)}>
            Повторить
          </Button>
        </div>
      ) : entry?.status === 'done' ? (
        <ArtistRow label="Артисты для подписки">
          {artists.map((a) => (
            <ArtistCard key={a.id} artist={a} subtitle="Популярно сейчас" action={<FollowButton artist={a} small />} />
          ))}
        </ArtistRow>
      ) : (
        <ArtistRow label="Загрузка артистов">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.placeholder} role="listitem">
              <Skeleton width={132} height={132} circle />
              <Skeleton width={90} height={12} />
            </div>
          ))}
        </ArtistRow>
      )}
    </section>
  );
}
