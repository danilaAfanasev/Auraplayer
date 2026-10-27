// Сохранить альбом или убрать — с тостом «Альбом сохранён» / «Альбом убран» и кнопкой «Вернуть».
import type { ArtistRelease } from '../../../shared/types';
import { useLibrary } from '../../stores/useLibrary';
import { useUi } from '../../stores/useUi';

/** Возвращает новое состояние «альбом сохранён». «Вернуть» в тосте отменяет это нажатие (без нового тоста). */
export function toggleAlbumSaved(release: ArtistRelease): boolean {
  const saved = useLibrary.getState().toggleAlbumLike(release);
  useUi.getState().toast(saved ? 'Альбом сохранён' : 'Альбом убран', {
    label: 'Вернуть',
    run: () => void useLibrary.getState().toggleAlbumLike(release),
  });
  return saved;
}
