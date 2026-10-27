// Проверка релиза (`ArtistRelease`), прочитанного с диска: кэш ленты и сохранённые альбомы в library.json.
import type { ArtistRelease, ReleaseKind } from './types';

const RELEASE_KINDS: readonly string[] = ['album', 'ep', 'single'] satisfies ReleaseKind[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const digits = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

/** Релиз из прочитанного JSON: только известные поля; битый (нет id, названия, вида, даты) — null. */
export function cleanRelease(v: unknown): ArtistRelease | null {
  if (!isObject(v) || !digits(v.id) || !nonEmpty(v.title) || !nonEmpty(v.artist) || !digits(v.artistId)) return null;
  if (typeof v.kind !== 'string' || !RELEASE_KINDS.includes(v.kind)) return null;
  if (typeof v.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.releaseDate)) return null;
  const r: ArtistRelease = {
    id: v.id,
    title: v.title,
    artist: v.artist,
    artistId: v.artistId,
    kind: v.kind as ReleaseKind,
    releaseDate: v.releaseDate,
    trackCount: typeof v.trackCount === 'number' && v.trackCount > 0 ? v.trackCount : 0,
  };
  if (nonEmpty(v.coverUrl) && v.coverUrl.startsWith('https://')) r.coverUrl = v.coverUrl;
  if (isObject(v.similarTo) && digits(v.similarTo.id) && nonEmpty(v.similarTo.name)) r.similarTo = { id: v.similarTo.id, name: v.similarTo.name };
  return r;
}
