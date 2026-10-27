// Текст песни играющего трека (G63): статус для кнопки «Текст» и сам текст для слоя с текстом. Запросы — через main
// (`window.aura.lyrics`), он же держит кэш на диске. Заранее просим текущий и следующие треки — как звук (PREPARE_AHEAD).
import { create } from 'zustand';
import type { Lyrics } from '../../shared/lyrics';
import type { Track } from '../../shared/types';
import { PREPARE_AHEAD, selectCurrentTrack, upcomingTracks, usePlayer } from './usePlayer';

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'none' | 'error';

interface LyricsState {
  /** Трек, которому принадлежит статус; `null` — очередь пуста. */
  trackId: string | null;
  /** `ready` — только когда текст есть (`lyrics.kind !== 'none'`); нет текста — `none`; сбой — `error`. */
  status: LyricsStatus;
  lyrics: Lyrics | null;
  /** Слой с текстом открыт (рисует таск 24). */
  open: boolean;
  setOpen(open: boolean): void;
}

export const useLyrics = create<LyricsState>((set) => ({
  trackId: null,
  status: 'idle',
  lyrics: null,
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Очередь меняется пачками (листание, волна): запрос «заранее» уходит после паузы — как подготовка звука. */
const PREFETCH_DEBOUNCE_MS = 300;

let started = false;
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
/** Что в последний раз просили у main (ключ — id через запятую): тот же набор повторно не просим. */
let prefetchedKey = '';

function load(track: Track): void {
  useLyrics.setState({ trackId: track.id, status: 'loading', lyrics: null });
  let request: Promise<Lyrics>;
  try {
    request = window.aura.lyrics.get(track);
  } catch (err) {
    request = Promise.reject(err);
  }
  void request.then(
    (lyrics) => {
      if (useLyrics.getState().trackId !== track.id) return; // пользователь уже ушёл дальше
      useLyrics.setState({ status: lyrics.kind === 'none' ? 'none' : 'ready', lyrics });
    },
    () => {
      if (useLyrics.getState().trackId !== track.id) return;
      useLyrics.setState({ status: 'error', lyrics: null });
    },
  );
}

function schedulePrefetch(): void {
  if (prefetchTimer) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    prefetchTimer = null;
    const s = usePlayer.getState();
    const current = selectCurrentTrack(s);
    if (!current) return;
    const tracks = [current, ...upcomingTracks(s, PREPARE_AHEAD)];
    const key = tracks.map((t) => t.id).join(',');
    if (key === prefetchedKey) return;
    prefetchedKey = key;
    void Promise.resolve()
      .then(() => window.aura.lyrics.prefetch(tracks))
      .catch(() => undefined);
  }, PREFETCH_DEBOUNCE_MS);
}

function sync(): void {
  const current = selectCurrentTrack(usePlayer.getState());
  if (!current) {
    if (useLyrics.getState().trackId !== null) useLyrics.setState({ trackId: null, status: 'idle', lyrics: null, open: false });
    return;
  }
  if (useLyrics.getState().trackId !== current.id) load(current);
}

/** Подключает стор к плееру один раз; вызывается при старте окна (`main.tsx`). */
export function initLyrics(): void {
  if (started) return;
  started = true;
  usePlayer.subscribe((s, prev) => {
    if (s.queue === prev.queue && s.index === prev.index && s.order === prev.order && s.shuffle === prev.shuffle && s.repeat === prev.repeat) return;
    sync();
    schedulePrefetch();
  });
  sync();
  schedulePrefetch();
}
