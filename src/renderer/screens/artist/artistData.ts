// Данные артистов из main с кэшем на время работы приложения: страницы, карточки поиска,
// подсказка с артистами и треки релизов. Возврат на экран — мгновенный.
import { useMemo } from 'react';
import { create } from 'zustand';
import { CATALOG_ARTIST_NOT_FOUND, type ArtistQuery } from '../../../shared/api';
import { artistKey, splitArtists } from '../../../shared/artistNames';
import { isArtistBlocked, withoutBlocked, type Blacklist } from '../../../shared/blacklist';
import type { AlbumPage, ArtistCard, ArtistPage, ArtistRef, ArtistRelease, FollowedArtist, NamesakeRef, PopularArtist, Track } from '../../../shared/types';
import { errorMessage } from '../../app/errors';
import { useBlacklist } from '../../stores/blacklistActions';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';
import { artistParam, openArtist } from './artistNav';

export type Loadable<T> = { status: 'loading' } | { status: 'done'; value: T } | { status: 'error'; message: string; offline: boolean };

const OFFLINE_TEXT = 'Нет соединения';
const MAX_KEYS = 40;

interface LoadableStore<A, T> {
  entries: Record<string, Loadable<T>>;
  /** Загрузить, если ещё нет (или была ошибка). */
  ensure(key: string, arg: A): void;
  retry(key: string, arg: A): void;
}

function createLoadableStore<A, T>(fetcher: (arg: A) => Promise<T>) {
  return create<LoadableStore<A, T>>((set, get) => {
    const put = (key: string, value: Loadable<T>) => {
      const entries = { ...get().entries, [key]: value };
      const keys = Object.keys(entries);
      if (keys.length > MAX_KEYS) delete entries[keys[0]];
      set({ entries });
    };
    const run = (key: string, arg: A) => {
      put(key, { status: 'loading' });
      fetcher(arg).then(
        (value) => put(key, { status: 'done', value }),
        (err: unknown) => {
          const message = errorMessage(err, 'Сервис недоступен');
          put(key, { status: 'error', message, offline: message === OFFLINE_TEXT });
        },
      );
    };
    return {
      entries: {},
      ensure(key, arg) {
        const st = get().entries[key];
        if (!st || st.status === 'error') run(key, arg);
      },
      retry: run,
    };
  });
}

export const useArtistPages = createLoadableStore<ArtistQuery, ArtistPage>((q) => window.aura.artists.page(q));
export const useArtistSearch = createLoadableStore<string, ArtistCard[]>((q) => window.aura.artists.search(q));
export const usePopularArtists = createLoadableStore<void, PopularArtist[]>(() => window.aura.artists.popular());
export const useReleaseTracks = createLoadableStore<string, Track[]>((id) => window.aura.artists.release(id));
/** Страницы альбомов по id релиза (экран `album`). */
export const useAlbumPages = createLoadableStore<string, AlbumPage>((id) => window.aura.artists.album(id));

export const pageKey = (q: ArtistQuery): string => artistParam(q);

/** Страница артиста без чёрного списка: популярные треки — без скрытых треков и исполнителей, «Похожие» — без скрытых. */
export function visibleArtistPage(page: ArtistPage, bl: Blacklist): ArtistPage {
  if (bl.tracks.length === 0 && bl.artists.length === 0) return page;
  return {
    ...page,
    topTracks: withoutBlocked(page.topTracks, bl, (t) => t),
    similar: page.similar.filter((a) => !isArtistBlocked(a.name, bl)),
  };
}

/** Состояние страницы артиста по ключу — уже без чёрного списка (таблица и «Слушать» получают один список). */
export function useArtistPage(key: string): Loadable<ArtistPage> | undefined {
  const entry = useArtistPages((s) => (key ? s.entries[key] : undefined));
  const bl = useBlacklist();
  return useMemo(() => (entry?.status === 'done' ? { status: 'done', value: visibleArtistPage(entry.value, bl) } : entry), [entry, bl]);
}

/**
 * Тёзки для переключателей страницы: подписанные — первыми. Страницу по имени с подсказкой-треком выбирает песня,
 * а не подписка (история 168), — к своему тёзке с неё нужен путь.
 */
export function visibleNamesakes(namesakes: readonly NamesakeRef[] | undefined, followed: readonly FollowedArtist[]): NamesakeRef[] {
  const ids = new Set(followed.map((a) => a.id));
  const list = namesakes ?? [];
  return [...list.filter((a) => ids.has(a.id)), ...list.filter((a) => !ids.has(a.id))];
}

/** Треки релиза: из кэша (или уже открытой страницы альбома) или запросом (параллельные вызовы — один запрос). */
export function loadRelease(id: string): Promise<Track[]> {
  const album = useAlbumPages.getState().entries[id];
  if (album?.status === 'done') return Promise.resolve(album.value.tracks);
  const st = useReleaseTracks.getState().entries[id];
  if (st?.status === 'done') return Promise.resolve(st.value);
  if (st?.status !== 'loading') useReleaseTracks.getState().retry(id, id);
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const e = useReleaseTracks.getState().entries[id];
      if (!e || e.status === 'loading') return false;
      if (e.status === 'done') resolve(e.value);
      else reject(new Error(e.message));
      return true;
    };
    if (check()) return;
    const unsub = useReleaseTracks.subscribe(() => {
      if (check()) unsub();
    });
  });
}

/** «Слушать» релиз: его треки по порядку. Не загрузились — тост с «Повторить». */
export async function playRelease(release: ArtistRelease, start = 0): Promise<void> {
  try {
    const tracks = await loadRelease(release.id);
    if (tracks.length > 0) usePlayer.getState().playList(tracks, Math.min(start, tracks.length - 1), release.title);
  } catch (err) {
    useUi
      .getState()
      .toast(
        `Не удалось открыть «${release.title}»: ${errorMessage(err)}`,
        { label: 'Повторить', run: () => void playRelease(release, start) },
        'error',
      );
  }
}

export const ARTIST_NOT_FOUND_MESSAGE = 'Не нашёл страницу артиста';

/** Ошибка страницы — «такого имени в каталоге нет» (а не сеть или сбой сервиса). */
export const isArtistNotFound = (st: Loadable<unknown> | undefined): boolean => st?.status === 'error' && st.message === CATALOG_ARTIST_NOT_FOUND;

/** Артисты с известным id, которых можно узнать по имени: имя и id каталога. */
export type KnownArtist = Pick<ArtistRef, 'id' | 'name'>;

/** Исполнитель релиза с id: только если исполнитель один (у «A & B» id релиза принадлежит одному из них — какому, неясно). */
export function releaseArtists(release: Pick<ArtistRelease, 'artist' | 'artistId'>): KnownArtist[] {
  const names = splitArtists(release.artist);
  return names.length === 1 && release.artistId ? [{ id: release.artistId, name: names[0] }] : [];
}

/**
 * Запрос страницы: имя, совпадающее (`artistKey`) с известным артистом, — его id; иначе как есть.
 * С подсказкой-треком — как есть: среди точных тёзок выбирает песня, а не подписка (история 168).
 */
export function artistQueryOf(query: ArtistQuery, known: readonly KnownArtist[]): ArtistQuery {
  if (!('name' in query) || query.track?.title.trim()) return query;
  const key = artistKey(query.name);
  const match = key ? known.find((a) => artistKey(a.name) === key) : undefined;
  return match ? { id: match.id } : query;
}

/**
 * Страница артиста по имени (ссылки на исполнителей). Известный артист (`known`, например единственный
 * исполнитель релиза) — сразу страница по его id. `track` — трек, с которого перешли: среди точных тёзок main
 * выберет исполнителя этой песни раньше подписок (история 168); без трека имя подписки — сразу страница по её id.
 * Иначе сначала данные по имени (кэш на время работы), потом переход; каталог знает только тёзку с похожим
 * именем или никого — открывается поиск по этому имени (ник SoundCloud не подменяется чужим артистом).
 * Нет сети — тост. Страница нашлась — true.
 */
export function openArtistByName(name: string, known: readonly KnownArtist[] = [], track?: { title: string }): Promise<boolean> {
  const title = track?.title.trim();
  const followed = title ? [] : useLibrary.getState().lib.followedArtists;
  const byId = artistQueryOf({ name: name.trim() }, [...known, ...followed]);
  if ('id' in byId) {
    openArtist(byId);
    return Promise.resolve(true);
  }
  const query: ArtistQuery = title ? { name: name.trim(), track: { title } } : { name: name.trim() };
  const key = pageKey(query);
  const store = useArtistPages.getState();
  if (store.entries[key]?.status !== 'done' && store.entries[key]?.status !== 'loading') store.retry(key, query);
  return new Promise((resolve) => {
    const check = (): boolean => {
      const e = useArtistPages.getState().entries[key];
      if (!e || e.status === 'loading') return false;
      if (e.status === 'done') {
        openArtist(query);
        resolve(true);
      } else if (isArtistNotFound(e)) {
        useUi.getState().setQuery(name.trim());
        resolve(false);
      } else {
        useUi.getState().toast(e.offline ? `${ARTIST_NOT_FOUND_MESSAGE}: нет соединения` : ARTIST_NOT_FOUND_MESSAGE, undefined, 'error');
        resolve(false);
      }
      return true;
    };
    if (check()) return;
    const unsub = useArtistPages.subscribe(() => {
      if (check()) unsub();
    });
  });
}
