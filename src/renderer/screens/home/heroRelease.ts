// Баннер-герой главной: самый свежий релиз подписок, а без подписок — первый трек «Популярного сейчас».
import type { ArtistRelease, CountryCode, Track } from '../../../shared/types';
import { releaseDateLabel, releaseKindLabel } from '../artist/releaseFormat';
import { useCharts } from '../charts/useCharts';

/** Страны чарта в родительном падеже: «В чарте Германии», «Чарт и каталог США». */
const COUNTRY_GENITIVE: Record<CountryCode, string> = {
  ru: 'России',
  us: 'США',
  gb: 'Великобритании',
  de: 'Германии',
  fr: 'Франции',
  ua: 'Украины',
  kz: 'Казахстана',
  by: 'Беларуси',
};

export const countryGenitive = (country: CountryCode | undefined): string | undefined => (country ? COUNTRY_GENITIVE[country] : undefined);

export interface HeroRelease {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  /** Подпись над названием. */
  eyebrow: string;
  /** Плашка в углу: позиция в чарте или дата выхода. */
  stat: { label: string; value: string; kind: 'chart' | 'release' };
  /** Что добавляется «В плейлист». */
  tracks: Track[];
  /** Очередь «Слушать» и трек, с которого начать. */
  queue: Track[];
  start: number;
  /** Баннер релиза: пока треки не загружены, «Слушать» загружает их сам. */
  release?: ArtistRelease;
}

/**
 * Баннер по чарту: его первый трек, «Слушать» — весь чарт по порядку. Чарт пуст — null.
 * `country` — страна чарта (по умолчанию — из последнего снимка чартов); плашка — «В чарте <страны>».
 */
export function chartHero(chart: Track[], country: CountryCode | undefined = useCharts.getState().country): HeroRelease | null {
  const first = chart[0];
  if (!first) return null;
  const hero: HeroRelease = {
    title: first.title,
    artist: first.artist,
    eyebrow: 'Популярное сейчас',
    stat: { label: ['В чарте', countryGenitive(country)].filter(Boolean).join(' '), value: '№1', kind: 'chart' },
    tracks: [first],
    queue: chart,
    start: 0,
  };
  if (first.album) hero.album = first.album;
  if (first.coverUrl) hero.coverUrl = first.coverUrl;
  return hero;
}

/** Баннер по свежему релизу подписки; `tracks` — его треки (null — ещё не загружены). */
export function releaseHero(release: ArtistRelease, tracks: Track[] | null, now = Date.now()): HeroRelease {
  const list = tracks ?? [];
  const hero: HeroRelease = {
    title: release.title,
    artist: release.artist,
    eyebrow: `Новое от моих артистов · ${releaseKindLabel(release.kind)}`,
    stat: { label: 'Дата выхода', value: releaseDateLabel(release.releaseDate, now), kind: 'release' },
    tracks: list,
    queue: list,
    start: 0,
    release,
  };
  if (release.coverUrl) hero.coverUrl = release.coverUrl;
  return hero;
}
