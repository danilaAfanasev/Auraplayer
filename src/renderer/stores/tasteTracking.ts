// Трекер вкуса: слушает плеер и библиотеку и пишет события скрытого рейтинга исполнителей
// (shared/taste.ts) — каждому исполнителю трека, включая фиты в названии. Логику плеера не трогает.
import { splitArtists } from '../../shared/artistNames';
import { isBlocked } from '../../shared/blacklist';
import type { TasteEvent, TasteEventKind } from '../../shared/taste';
import type { Track } from '../../shared/types';
import { useLibrary } from './useLibrary';
import { usePlayer, type TrackLeaveEvent } from './usePlayer';

/** Пользователь ушёл с трека раньше стольких секунд звучания — пропуск. */
export const SKIP_BEFORE_SEC = 30;
/** Сыграна такая доля трека — «дослушал». */
export const COMPLETE_SHARE = 0.8;

/**
 * Что значит уход с трека для вкуса: дослушал, пропустил или ничего. Трек, который так и не зазвучал
 * (звук ещё искался, быстрое листание), — не оценка исполнителя: ничего.
 */
export function leaveKind(e: TrackLeaveEvent): TasteEventKind | null {
  if (!(e.playedSec > 0)) return null;
  if (e.cause === 'ended' || (e.durationSec > 0 && e.playedSec >= COMPLETE_SHARE * e.durationSec)) return 'complete';
  if (e.cause === 'user' && e.playedSec < SKIP_BEFORE_SEC) return 'skip';
  return null;
}

function eventsFor(track: Track, kind: TasteEventKind, at: number): TasteEvent[] {
  return splitArtists(track.artist, track.title).map((artist) => ({ artist, kind, at }));
}

let started = false;

/** Подключает трекер один раз; вызывается при старте окна (рядом с историей). */
export function initTasteTracking(): void {
  if (started) return;
  started = true;

  usePlayer.getState().onTrackLeave((e) => {
    const kind = leaveKind(e);
    if (!kind) return;
    const library = useLibrary.getState();
    // Скрытый трек («Не нравится» с переходом дальше) уже получил своё — пропуск сверху не нужен.
    if (isBlocked(e.track, library.lib.blacklist)) return;
    library.recordTaste(eventsFor(e.track, kind, Date.now()));
  });

  useLibrary.subscribe((s, prev) => {
    // Загрузка library.json — не действия пользователя.
    if (!prev.loaded || s.lib === prev.lib) return;
    const now = Date.now();
    const out: TasteEvent[] = [];
    if (s.lib.likes !== prev.lib.likes) {
      const before = new Set(prev.lib.likes);
      const added = s.lib.likes.filter((id) => !before.has(id));
      // Лайк ставится по одному; разом много — это не нажатие (например, повторная загрузка библиотеки).
      if (added.length === 1 && s.lib.tracks[added[0]]) out.push(...eventsFor(s.lib.tracks[added[0]], 'like', now));
    }
    if (s.lib.followedArtists !== prev.lib.followedArtists) {
      const before = new Set(prev.lib.followedArtists.map((a) => a.id));
      for (const a of s.lib.followedArtists) if (!before.has(a.id)) out.push({ artist: a.name, kind: 'follow', at: now });
    }
    if (out.length > 0) s.recordTaste(out);
  });
}
