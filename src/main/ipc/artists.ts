// Артисты: карточки поиска, страница артиста, треки релиза, популярные артисты страны и лента подписок.
// Лента живёт в сервисе чартов (то же расписание и кэш), здесь — только её IPC.
import type { ArtistFeedSnapshot, ArtistQuery } from '../../shared/api';
import { IPC } from '../../shared/ipc';
import { ownArtistsOf } from '../../shared/artistSearch';
import type { AlbumPage, ArtistCard, ArtistPage, PopularArtist, Track } from '../../shared/types';
import { artists } from '../sources/artists';
import { loadLibrary } from './library';
import { SourceError } from '../sources/types';
import { chartsService } from './charts';
import { assertString, handle, UserError } from './handle';

function assertQuery(q: unknown): asserts q is ArtistQuery {
  const ok =
    typeof q === 'object' &&
    q !== null &&
    (typeof (q as { id?: unknown }).id === 'string' || typeof (q as { name?: unknown }).name === 'string');
  if (!ok) throw new UserError('Неверный параметр: артист');
}

/** Ошибка источника — человеческий текст как есть, код — вид ошибки (offline, unavailable…). */
function asUserError<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    throw err instanceof SourceError ? new UserError(err.message, err.kind) : err;
  });
}

export function registerArtistsIpc(): void {
  handle(IPC.artists.search, async (query: unknown): Promise<ArtistCard[]> => {
    assertString(query, 'запрос');
    // Свои артисты (подписки, вкус, лайки, история) — из library.json: идут первыми.
    const own = await loadLibrary()
      .then((lib) => ownArtistsOf(lib, Date.now()))
      .catch(() => []);
    return asUserError(artists.search(query, own));
  });
  handle(IPC.artists.page, (query: unknown): Promise<ArtistPage> => {
    assertQuery(query);
    return asUserError(artists.page(query));
  });
  handle(IPC.artists.release, (releaseId: unknown): Promise<Track[]> => {
    assertString(releaseId, 'релиз');
    return asUserError(artists.release(releaseId));
  });
  handle(IPC.artists.album, (releaseId: unknown): Promise<AlbumPage> => {
    assertString(releaseId, 'релиз');
    return asUserError(artists.album(releaseId));
  });
  handle(IPC.artists.popular, (): Promise<PopularArtist[]> => asUserError(artists.popular()));
  handle(IPC.artists.feed, (): Promise<ArtistFeedSnapshot> => chartsService.feedSnapshot());
  handle(IPC.artists.refreshFeed, (): Promise<ArtistFeedSnapshot> => chartsService.refreshFeed());
}
