// Подписи релизов: дата выхода и вид (альбом, EP, сингл).
import type { ArtistRelease, ReleaseKind } from '../../../shared/types';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** `2026-07-24` → «24 июля»; не в этом году — «12 декабря 2025». */
export function releaseDateLabel(date: string, now = Date.now()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12) return '';
  const base = `${day} ${MONTHS[month - 1]}`;
  return year === new Date(now).getFullYear() ? base : `${base} ${year}`;
}

const KIND_LABELS: Record<ReleaseKind, string> = { album: 'Альбом', ep: 'EP', single: 'Сингл' };

export function releaseKindLabel(kind: ReleaseKind): string {
  return KIND_LABELS[kind];
}

/** Разделы страницы артиста: «Альбомы» (альбомы и EP) и «Синглы», в прежнем порядке (от новых к старым). */
export function splitReleases(releases: readonly ArtistRelease[]): { albums: ArtistRelease[]; singles: ArtistRelease[] } {
  return { albums: releases.filter((r) => r.kind !== 'single'), singles: releases.filter((r) => r.kind === 'single') };
}
