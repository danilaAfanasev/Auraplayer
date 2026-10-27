import { Heart } from 'lucide-react';
import { useState } from 'react';
import type { ArtistRelease } from '../../../shared/types';
import { useIsAlbumLiked } from '../../stores/useLibrary';
import { IconButton } from '../Button/Button';
import { toggleAlbumSaved } from './albumLikeAction';
import styles from './AlbumLikeButton.module.css';

interface Props {
  release: ArtistRelease;
  size?: 'small' | 'medium' | 'large';
  /**
   * `button` — обычная кнопка-сердечко в ряду кнопок (страница альбома);
   * `overlay` — поверх обложки карточки: при наведении, у сохранённого видна всегда.
   */
  variant?: 'button' | 'overlay';
  className?: string;
}

/** Сердечко «Сохранить альбом»: альбом попадает в «Альбомы» библиотеки, его треки в «Мне нравится» не добавляются. */
export function AlbumLikeButton({ release, size = 'medium', variant = 'button', className }: Props) {
  const liked = useIsAlbumLiked(release.id);
  // Пружинка только в момент нажатия, а не при каждой отрисовке списка.
  const [pop, setPop] = useState(false);
  return (
    <IconButton
      icon={Heart}
      size={size}
      filled={liked}
      active={liked}
      label={liked ? 'Убрать из альбомов' : 'Сохранить альбом'}
      className={[variant === 'overlay' ? styles.overlay : styles.button, liked ? styles.liked : '', pop ? styles.pop : '', className]
        .filter(Boolean)
        .join(' ')}
      onClick={() => setPop(toggleAlbumSaved(release))}
      onAnimationEnd={() => setPop(false)}
    />
  );
}
