// Переход на страницу артиста. Параметр экрана: `id:<id каталога>` или `name:<имя>`
// (похожие артисты известны только по имени — страница находит их в каталоге сама).
import type { ArtistQuery } from '../../../shared/api';
import { useUi, type Screen } from '../../stores/useUi';

/** Разделитель имени и подсказки-трека в параметре: `name:<имя>|track:<название>`. */
const TRACK_MARK = '|track:';

export function artistParam(q: ArtistQuery): string {
  if ('id' in q) return `id:${q.id}`;
  const title = q.track?.title.trim();
  // Подсказка — часть ключа страницы: от неё зависит, какой из тёзок откроется. Имя с самим разделителем — без подсказки.
  return title && !q.name.includes(TRACK_MARK) ? `name:${q.name}${TRACK_MARK}${title}` : `name:${q.name}`;
}

export function parseArtistParam(param: string | undefined): ArtistQuery | null {
  if (!param) return null;
  const id = /^id:(\d+)$/.exec(param)?.[1];
  if (id) return { id };
  if (param.startsWith('name:')) {
    const rest = param.slice(5);
    const at = rest.indexOf(TRACK_MARK);
    const name = at < 0 ? rest : rest.slice(0, at);
    const title = at < 0 ? '' : rest.slice(at + TRACK_MARK.length);
    if (!name.trim()) return null;
    return title.trim() ? { name, track: { title } } : { name };
  }
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
