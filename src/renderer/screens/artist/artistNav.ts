// Переход на страницу артиста. Параметр экрана: `id:<id каталога>` или `name:<имя>`
// (похожие артисты известны только по имени — страница находит их в каталоге сама).
import type { ArtistQuery } from '../../../shared/api';
import { useUi, type Screen } from '../../stores/useUi';

export function artistParam(q: ArtistQuery): string {
  return 'id' in q ? `id:${q.id}` : `name:${q.name}`;
}

export function parseArtistParam(param: string | undefined): ArtistQuery | null {
  if (!param) return null;
  const id = /^id:(\d+)$/.exec(param)?.[1];
  if (id) return { id };
  if (param.startsWith('name:') && param.slice(5).trim()) return { name: param.slice(5) };
  return null;
}

export const artistScreen = (q: ArtistQuery): Screen => ({ name: 'artist', param: artistParam(q) });

export function openArtist(q: ArtistQuery): void {
  useUi.getState().navigate(artistScreen(q));
}

/** Страница альбома: параметр экрана — id релиза в каталоге. */
export const albumScreen = (releaseId: string): Screen => ({ name: 'album', param: releaseId });

export function openAlbum(releaseId: string): void {
  useUi.getState().navigate(albumScreen(releaseId));
}
