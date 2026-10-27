import { Heart } from 'lucide-react';
import { useState } from 'react';
import type { Track } from '../../../shared/types';
import { useLibrary } from '../../stores/useLibrary';
import { IconButton } from '../Button/Button';
import styles from './LikeButton.module.css';

interface Props {
  /** Трек, которому ставят «нравится»; null — кнопка неактивна (ничего не играет). */
  track: Track | null;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

/** Сердечко «Мне нравится»: клик ставит или снимает, залитое — уже стоит. */
export function LikeButton({ track, size = 'small', className }: Props) {
  const liked = useLibrary((s) => (track ? s.lib.likes.includes(track.id) : false));
  // Пружинка только в момент нажатия, а не при каждой отрисовке списка.
  const [pop, setPop] = useState(false);
  return (
    <IconButton
      icon={Heart}
      size={size}
      filled={liked}
      active={liked}
      disabled={!track}
      label={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
      className={[pop ? styles.pop : '', className].filter(Boolean).join(' ')}
      onClick={() => track && setPop(useLibrary.getState().toggleLike(track))}
      onAnimationEnd={() => setPop(false)}
    />
  );
}
