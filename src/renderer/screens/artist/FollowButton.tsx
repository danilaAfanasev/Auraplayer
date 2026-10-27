import { Check, UserPlus } from 'lucide-react';
import type { ArtistRef } from '../../../shared/types';
import { Button } from '../../components/Button/Button';
import { useIsFollowing, useLibrary } from '../../stores/useLibrary';
import styles from './FollowButton.module.css';

/** «Подписаться» / «Вы подписаны» (повторный клик — отписка). */
export function FollowButton({ artist, small = false }: { artist: ArtistRef; small?: boolean }) {
  const following = useIsFollowing(artist.id);
  return (
    <Button
      variant={following ? 'outline' : 'accent'}
      icon={following ? Check : UserPlus}
      aria-pressed={following}
      title={following ? `Отписаться от ${artist.name}` : `Подписаться на ${artist.name}`}
      className={small ? styles.small : undefined}
      onClick={(e) => {
        e.stopPropagation();
        const lib = useLibrary.getState();
        if (following) lib.unfollow(artist.id);
        else lib.follow(artist);
      }}
    >
      {following ? 'Вы подписаны' : 'Подписаться'}
    </Button>
  );
}
