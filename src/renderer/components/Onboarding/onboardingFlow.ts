// Первый запуск «Что ты слушаешь?»: кому показывать, порядок популярных артистов, «Готово» и «Пропустить».
import { isArtistBlocked, type Blacklist } from '../../../shared/blacklist';
import { cleanGenres } from '../../../shared/taste';
import type { ArtistRef, LibraryData, PopularArtist, Settings } from '../../../shared/types';
import { useLibrary } from '../../stores/useLibrary';
import { useSettings } from '../../stores/useSettings';

/**
 * Показывать, пока первый запуск не пройден и библиотека пуста. Старый пользователь получает `onboarded: true`
 * из `normalizeSettings`; пустая папка скачивания — настройки не прочитались (заглушка), такого не беспокоим.
 */
export function needsOnboarding(settings: Settings, lib: LibraryData): boolean {
  if (settings.onboarded || !settings.downloadDir) return false;
  return lib.followedArtists.length === 0 && lib.likes.length === 0 && lib.history.length === 0 && lib.playlists.length === 0;
}

/** Популярные без скрытых; выбраны жанры — артисты этих жанров первыми, порядок чарта внутри сохраняется. */
export function rankPopular(list: readonly PopularArtist[], tags: readonly string[], bl: Blacklist): PopularArtist[] {
  const visible = list.filter((a) => !isArtistBlocked(a.name, bl));
  if (tags.length === 0) return visible;
  const fits = (a: PopularArtist) => (a.tags ?? []).some((t) => tags.includes(t));
  return [...visible.filter(fits), ...visible.filter((a) => !fits(a))];
}

/** «Готово»: выбранным артистам — стартовый вкус и подписка, жанры — во вкус; экран больше не показывается. */
export function finishOnboarding(choice: { artists: readonly ArtistRef[]; genres: readonly string[] }, now = Date.now()): void {
  const library = useLibrary.getState();
  if (choice.artists.length > 0) {
    library.recordTaste(choice.artists.map((a) => ({ artist: a.name, kind: 'onboard' as const, at: now })));
    library.followMany(choice.artists);
  }
  const genres = cleanGenres(choice.genres);
  if (genres.length > 0) library.setTasteGenres(genres);
  useSettings.getState().update({ onboarded: true });
}

/** «Пропустить» — сразу на главную, без вкуса. */
export function skipOnboarding(): void {
  useSettings.getState().update({ onboarded: true });
}
