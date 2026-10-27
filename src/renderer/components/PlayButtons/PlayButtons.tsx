import { Play, Shuffle } from 'lucide-react';
import type { Track } from '../../../shared/types';
import { Button } from '../Button/Button';
import { playAll, playShuffled } from './playActions';

interface Props {
  tracks: Track[];
  /** Кнопки видны, но неактивны (например, пустой плейлист). */
  disabled?: boolean;
  /** Без «Перемешать» (история — порядок важен). */
  shuffle?: boolean;
  /** Имя списка — заголовок очереди в правой колонке. */
  title?: string;
}

/** Кнопки шапки экрана со списком: «Слушать» (с первого трека) и «Перемешать». */
export function PlayButtons({ tracks, disabled = false, shuffle = true, title }: Props) {
  return (
    <>
      <Button icon={Play} disabled={disabled} onClick={() => playAll(tracks, title)}>
        Слушать
      </Button>
      {shuffle && (
        <Button variant="outline" icon={Shuffle} disabled={disabled} onClick={() => playShuffled(tracks, title)}>
          Перемешать
        </Button>
      )}
    </>
  );
}
