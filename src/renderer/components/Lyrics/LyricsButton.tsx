import { MicVocal } from 'lucide-react';
import { useLyrics } from '../../stores/useLyrics';
import { IconButton } from '../Button/Button';
import { lyricsButtonLabel } from './lyricsView';

/** Атрибут кнопки «Текст»: слой текста сворачивается кругом обратно в неё. */
export const LYRICS_BUTTON_ATTR = 'data-lyrics-button';

/**
 * Кнопка «Текст» в панели плеера (микрофон), рядом с эквалайзером. Серая и некликабельная, пока текст ищется
 * и если его нет; когда текст есть — открывает слой с текстом на всё окно: он раскрывается кругом из центра кнопки.
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
      {...{ [LYRICS_BUTTON_ATTR]: '' }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        useLyrics.getState().setOpen(true, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    />
  );
}
