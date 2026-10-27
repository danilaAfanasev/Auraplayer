import { MicVocal } from 'lucide-react';
import { useLyrics } from '../../stores/useLyrics';
import { IconButton } from '../Button/Button';
import { lyricsButtonLabel } from './lyricsView';

/**
 * Кнопка «Текст» в панели плеера (микрофон), рядом с эквалайзером. Серая и некликабельная, пока текст ищется
 * и если его нет; когда текст есть — открывает слой с текстом на всё окно.
 */
export function LyricsButton({ size = 'medium' }: { size?: 'small' | 'medium' | 'large' }) {
  const status = useLyrics((s) => s.status);
  const open = useLyrics((s) => s.open);
  return (
    <IconButton
      icon={MicVocal}
      size={size}
      label={lyricsButtonLabel(status)}
      disabled={status !== 'ready'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => useLyrics.getState().setOpen(true)}
    />
  );
}
