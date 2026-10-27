// Плеер: очередь, текущий трек, громкость, повтор/перемешивание. Звук — через audioEngine (играющий <audio>
// и предзагрузочный). Пока трек звучит, следующие готовятся заранее: main ищет их звук (не больше PREPARE_AHEAD
// вперёд, устаревшее отменяет), начало следующего подгружается — «Далее» и автопереход звучат сразу.
// Громкость, повтор, перемешивание и последняя сессия сохраняются через useSettings.update.
import { create } from 'zustand';
import { isBlocked } from '../../shared/blacklist';
import { isRetiredTrack } from '../../shared/library';
import { nextIndex, prevIndex, shuffleOrder, type QueueState } from '../../shared/queue';
import { CATALOG_NEEDS_YOUTUBE_MESSAGE, type RepeatMode, type SourceId, type Track } from '../../shared/types';
import { errorMessage } from '../app/errors';
import { audioEngine } from '../audioEngine';
import { onBeforeCloseSave } from './persist';
import { useLibrary } from './useLibrary';
import { useSettings } from './useSettings';
import { useUi } from './useUi';

/** Трек не начал играть за это время — считаем недоступным (кроме источников из WAIT_SOURCES). */
export const LOAD_TIMEOUT_MS = 15_000;
/**
 * Звук этих источников ищет yt-dlp: в России без VPN это может занять минуту. Таймера нет — плеер ждёт;
 * сорвалась загрузка — одна повторная попытка, затем тост «Повторить», очередь не листается.
 */
export const WAIT_SOURCES: readonly SourceId[] = ['youtube', 'catalog', 'soundcloud'];
export const LOAD_FAILED_MESSAGE = 'Не удалось загрузить трек';
export const ALL_HIDDEN_MESSAGE = 'Все треки списка — в чёрном списке';
/** Столько недоступных треков подряд — и плеер останавливается (скорее всего, нет сети). */
const MAX_FAILURES_IN_ROW = 5;
/** Как часто сохранять позицию во время проигрывания. */
const POSITION_SAVE_STEP_SEC = 5;
/** Снимки треков очереди для восстановления после перезапуска (в settings.json — только id). */
const QUEUE_CACHE_KEY = 'aura.player.queue';
const QUEUE_CACHE_LIMIT = 500;

/** Почему трек перестал быть текущим: доиграл; пользователь переключил (next/prev/playAt/playList); не включился; очередь сменилась сама. */
export type TrackLeaveCause = 'ended' | 'user' | 'error' | 'replace';

export interface TrackLeaveEvent {
  track: Track;
  /** Сколько секунд трек реально звучал (перемотка не считается). */
  playedSec: number;
  /** Длительность трека (0 — неизвестна). */
  durationSec: number;
  cause: TrackLeaveCause;
}

export interface PlayerState {
  queue: Track[];
  /** Что играет — заголовок очереди («Мне нравится», плейлист…); `undefined` — не задан. */
  queueTitle?: string;
  index: number;
  isPlaying: boolean;
  isLoading: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Порядок проигрывания при перемешивании (см. shared/queue.ts). */
  order: number[];

  /** Очередь — этот список, играть с `startIndex`; `title` — заголовок очереди. */
  playList(tracks: Track[], startIndex: number, title?: string): void;
  /** Играть трек очереди с номером `index`. */
  playAt(index: number): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  cycleRepeat(): void;
  toggleShuffle(): void;
  /**
   * Дописать треки в конец очереди, не трогая играющий (волна). Ждали продолжения — играет первый новый;
   * пустой список — продолжения не будет, ожидание снимается.
   */
  appendTracks(tracks: Track[]): void;
  /** Убрать из ещё не сыгранной части очереди треки, подходящие под условие (волна: «Не нравится»). */
  removeUpcoming(match: (track: Track) => boolean): void;
  /**
   * Подписка на уход с трека: текущий трек перестал быть текущим (или доиграл — в том числе при повторе одного).
   * Возвращает отписку.
   */
  onTrackLeave(cb: (e: TrackLeaveEvent) => void): () => void;
}

// ---- состояние загрузки (вне стора: не нужно для отрисовки) ----
let loadToken = 0;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
/** id трека, который сейчас загружен в <audio>. */
let loadedId: string | null = null;
/** Хочет ли пользователь, чтобы загружаемый трек заиграл. */
let wantPlay = false;
/** Сколько треков подряд не удалось включить — чтобы не крутиться по недоступной очереди. */
let failuresInRow = 0;
/** Сорвавшиеся загрузки текущего трека из WAIT_SOURCES (повторная попытка — одна). */
let retriesLeft = 0;
/** Очередь кончилась, а волна ещё подбирает треки: первый дописанный трек заиграет сам. */
let awaitingMore = false;
/** Конец очереди: вернуть true — продолжение будет (волна дописывает очередь), плеер ждёт. */
let queueEndHook: (() => boolean) | null = null;
/** Хук конца очереди выполняется сейчас (он может сразу, внутри себя, вызвать appendTracks). */
let endHookRunning = false;

// ---- звучание текущего трека: для событий ухода (вкус) ----
/** Больше этого между двумя timeupdate — перемотка, а не звучание. */
const MAX_TIME_STEP_SEC = 2;
/** Текущий трек и сколько он звучал; null — уход уже сообщён (трек доиграл). */
let listen: { track: Track; playedSec: number; lastSec: number | null } | null = null;
/** Причина ухода для следующего startTrack без своей: «Далее» в конце очереди, а трек допишет волна. */
let pendingCause: TrackLeaveCause = 'replace';
const leaveListeners = new Set<(e: TrackLeaveEvent) => void>();

/** Сколько треков вперёд готовится звук (поиск и ссылка в main), пока играет текущий. */
export const PREPARE_AHEAD = 3;
/** Ссылка из предзагрузки старше этого не используется: ссылки живут часы, но берём с запасом. */
const PRELOAD_MAX_AGE_MS = 40 * 60_000;
/** Очередь меняется пачками (волна дописывает, перемешивание): подготовка пересчитывается после паузы. */
const PREPARE_DEBOUNCE_MS = 300;

// ---- подготовка следующих треков (вне стора: не нужно для отрисовки) ----
/** Ссылка следующего трека, подгружаемого во второй <audio>: переход на него — без ожидания. */
let preloaded: { trackId: string; url: string; at: number } | null = null;
/** Идёт поиск ссылки следующего трека: если пользователь перейдёт на него раньше, ждём этот же запрос. */
let preloading: { trackId: string; promise: Promise<string> } | null = null;
/** Для какой загрузки уже запрошена подготовка следующих (один раз на заигравший трек). */
let preparedFor: number | null = null;
/** Что плеер в последний раз просил main готовить. */
let preparedIds = new Set<string>();
let prepareTimer: ReturnType<typeof setTimeout> | null = null;

/** Волна подключает себя к концу очереди; null — отключить. */
export function setQueueEndHook(hook: (() => boolean) | null): void {
  queueEndHook = hook;
}

const waitsForSound = (track: Track | undefined): boolean => !!track && WAIT_SOURCES.includes(track.source);

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

function clearLoadTimer(): void {
  if (loadTimer) clearTimeout(loadTimer);
  loadTimer = null;
}

function queueState(s: Pick<PlayerState, 'queue' | 'index' | 'repeat' | 'shuffle' | 'order'>): QueueState {
  return { length: s.queue.length, index: s.index, repeat: s.repeat, shuffle: s.shuffle, order: s.order };
}

/** Трек в чёрном списке: сам плеер его не включает (свои списки показывают его приглушённым). */
function isHidden(track: Track | undefined): boolean {
  return !!track && isBlocked(track, useLibrary.getState().lib.blacklist);
}

/**
 * Первый не скрытый трек, начиная с кандидата `first` (от nextIndex/prevIndex) и дальше шагами `step`.
 * Дошли до текущего — он и есть ответ (повтор «всё»); скрыты все — null.
 */
function skipHidden(s: PlayerState, first: number | null, step: (state: QueueState) => number | null): number | null {
  let n = first;
  const seen = new Set<number>();
  while (n !== null && n !== s.index && isHidden(s.queue[n])) {
    if (seen.has(n)) return null;
    seen.add(n);
    n = step({ ...queueState(s), index: n });
  }
  return n;
}

/** Следующий для «Далее» и автоперехода — без скрытых. */
function nextPlayable(s: PlayerState, manual: boolean): number | null {
  return skipHidden(s, nextIndex(queueState(s), manual), (state) => nextIndex(state, true));
}

export const usePlayer = create<PlayerState>((set, get) => {
  /** `retry` — повторная попытка того же трека: позиция сохраняется, ссылка на звук запрашивается заново. */
  function startTrack(index: number, opts: { autoplay: boolean; startAt?: number; retry?: boolean; cause?: TrackLeaveCause }): void {
    const track = get().queue[index];
    if (!track) return;
    if (listen && listen.track.id !== track.id) leaveTrack(opts.cause ?? pendingCause);
    pendingCause = 'replace';
    const token = ++loadToken;
    if (!opts.retry) retriesLeft = 1;
    awaitingMore = false;
    const startAt = opts.startAt ?? 0;
    if (!listen) listen = { track, playedSec: 0, lastSec: startAt };
    else listen.lastSec = startAt;
    clearLoadTimer();
    // Трек подготовлен, пока играл прошлый: начало уже подгружено (звук сразу) или ссылка уже ищется (ждём её же).
    const ready = !opts.retry && preloaded?.trackId === track.id && Date.now() - preloaded.at < PRELOAD_MAX_AGE_MS ? preloaded : null;
    const pending = !opts.retry && !ready && preloading?.trackId === track.id ? preloading.promise : null;
    preloaded = null;
    preloading = null;
    // Прошлый трек замолкает сразу: поиск звука нового может занять секунды.
    if (loadedId) audioEngine.stop();
    if (!ready) audioEngine.cancelPreload();
    loadedId = null;
    wantPlay = opts.autoplay;
    set({ index, isLoading: true, isPlaying: false, positionSec: startAt, durationSec: track.durationSec ?? 0 });
    // Готовить дальше — когда этот заиграет; пока — только он (быстрое листание не оставляет лишних подготовок).
    requestPreparation(false);

    if (!waitsForSound(track)) loadTimer = setTimeout(() => fail(token), LOAD_TIMEOUT_MS);
    const loaded = (url: string) => {
      if (token !== loadToken) return;
      loadedId = track.id;
      audioEngine.load(url, startAt, wantPlay);
      if (!wantPlay) {
        // Загрузили на паузе: индикатор загрузки не держим.
        clearLoadTimer();
        set({ isLoading: false });
      }
    };
    if (ready) {
      loaded(ready.url);
      return;
    }
    (pending ?? (opts.retry ? window.aura.resolveStream(track, { fresh: true }) : window.aura.resolveStream(track)))
      .then(loaded)
      .catch((err: unknown) => fail(token, errorMessage(err, '')));
  }

  /** Сообщить подписчикам, что текущий трек перестал быть текущим (один раз на трек). */
  function leaveTrack(cause: TrackLeaveCause): void {
    const l = listen;
    listen = null;
    if (!l) return;
    const e: TrackLeaveEvent = { track: l.track, playedSec: l.playedSec, durationSec: get().durationSec || l.track.durationSec || 0, cause };
    for (const cb of [...leaveListeners]) {
      try {
        cb(e);
      } catch {
        // подписчик не должен ломать плеер
      }
    }
  }

  /** Звучание текущего трека: шаги timeupdate во время игры; скачок (перемотка) не считается. */
  function countPlayed(sec: number): void {
    const s = get();
    const current = s.queue[s.index];
    if (!current || current.id !== loadedId) return;
    // Трек доиграл и заиграл снова (повтор одного, «играть» после конца очереди) — новое прослушивание.
    if (!listen) listen = { track: current, playedSec: 0, lastSec: null };
    if (listen.track.id !== current.id) return;
    if (listen.lastSec !== null && s.isPlaying) {
      const step = sec - listen.lastSec;
      if (step > 0 && step <= MAX_TIME_STEP_SEC) listen.playedSec += step;
    }
    listen.lastSec = sec;
  }

  /** `reason` — текст ошибки источника; для треков из WAIT_SOURCES он показывается в тосте. */
  function fail(token: number, reason = ''): void {
    if (token !== loadToken) return;
    clearLoadTimer();
    loadToken++;
    loadedId = null;
    audioEngine.stop();
    const s = get();
    const track = s.queue[s.index];
    if (!wantPlay) {
      set({ isLoading: false, isPlaying: false });
      return;
    }
    // Трек убранного источника (Jamendo) без скачанного файла: играть нечего — остаёмся на нём и объясняем.
    if (track && isRetiredTrack(track)) {
      set({ isLoading: false, isPlaying: false });
      failuresInRow = 0;
      useUi.getState().toast(reason || LOAD_FAILED_MESSAGE, undefined, 'error');
      return;
    }
    // Каталог без YouTube: звук взять неоткуда — не листаем очередь, а подсказываем, где включить.
    if (track?.source === 'catalog' && reason === CATALOG_NEEDS_YOUTUBE_MESSAGE) {
      set({ isLoading: false, isPlaying: false });
      failuresInRow = 0;
      useUi.getState().toast(reason, { label: 'Настройки', run: () => useUi.getState().navigate({ name: 'settings' }) }, 'error');
      return;
    }
    if (waitsForSound(track)) {
      failuresInRow = 0;
      // Звук через yt-dlp: ещё одна попытка с новой ссылкой; не вышло — остаёмся на треке и предлагаем повторить.
      if (retriesLeft > 0) {
        retriesLeft--;
        startTrack(s.index, { autoplay: true, startAt: s.positionSec, retry: true });
        return;
      }
      set({ isLoading: false, isPlaying: false });
      const index = s.index;
      useUi.getState().toast(
        reason ? `${LOAD_FAILED_MESSAGE}: ${reason}` : LOAD_FAILED_MESSAGE,
        {
          label: 'Повторить',
          run: () => {
            const p = get();
            if (p.queue[index]?.id === track!.id) startTrack(index, { autoplay: true, startAt: p.index === index ? p.positionSec : 0 });
          },
        },
        'error',
      );
      return;
    }
    failuresInRow++;
    const limit = Math.min(s.queue.length, MAX_FAILURES_IN_ROW);
    const next = failuresInRow < limit ? nextPlayable(s, true) : null;
    const title = track ? `«${track.title}»` : '';
    if (next === null || next === s.index) {
      set({ isLoading: false, isPlaying: false });
      useUi
        .getState()
        .toast(
          failuresInRow > 1
            ? 'Несколько треков подряд не включились — проверь соединение'
            : `Не удалось включить трек ${title}`,
          undefined,
          'error',
        );
      failuresInRow = 0;
      return;
    }
    useUi.getState().toast(`Трек ${title} недоступен — включаю следующий`, undefined, 'error');
    startTrack(next, { autoplay: true, cause: 'error' });
  }

  /**
   * Конец очереди во время волны: тишина и «Загрузка…», пока волна не допишет треки.
   * Хук может ответить сразу, внутри себя (`appendTracks` с треками или пустой): тогда ждать нечего.
   * true — плеер ждёт или уже включил дописанный трек; false — продолжения нет.
   */
  function waitForMore(): boolean {
    if (!queueEndHook) return false;
    const token = loadToken;
    awaitingMore = true;
    endHookRunning = true;
    let more = false;
    try {
      more = queueEndHook();
    } finally {
      endHookRunning = false;
    }
    // Хук уже ответил: дописанный трек включился (новая загрузка) или продолжения не будет.
    if (!awaitingMore) return loadToken !== token;
    if (!more) {
      awaitingMore = false;
      return false;
    }
    wantPlay = true;
    clearLoadTimer();
    if (loadedId) audioEngine.pause();
    set({ isLoading: true, isPlaying: false });
    return true;
  }

  function onEnded(): void {
    leaveTrack('ended');
    const s = get();
    const n = nextPlayable(s, false);
    if (n === null) {
      if (waitForMore()) return;
      // Очередь закончилась: останавливаемся в начале последнего трека.
      wantPlay = false;
      audioEngine.pause();
      audioEngine.seek(0);
      set({ isPlaying: false, isLoading: false, positionSec: 0 });
      return;
    }
    if (n === s.index) {
      audioEngine.seek(0);
      audioEngine.play();
      return;
    }
    startTrack(n, { autoplay: true });
  }

  // Пока звук нового трека ищется (loadedId === null), события <audio> относятся к прошлой
  // загрузке — они не меняют состояние нового трека.
  audioEngine.on({
    time: (sec) => {
      if (!loadedId) return;
      countPlayed(sec);
      set({ positionSec: sec });
    },
    duration: (sec) => {
      if (loadedId) set({ durationSec: sec });
    },
    playing: () => {
      if (!loadedId) return;
      clearLoadTimer();
      failuresInRow = 0;
      // Заиграл — следующему срыву (например, протухла ссылка посреди трека) снова положена повторная попытка.
      retriesLeft = 1;
      set({ isPlaying: true, isLoading: false });
      // Пока он звучит — готовим следующие: звук ищется заранее, начало следующего подгружается.
      if (preparedFor !== loadToken) {
        preparedFor = loadToken;
        requestPreparation(true);
        preloadNext();
      }
    },
    paused: () => set({ isPlaying: false }),
    waiting: () => {
      if (loadedId && wantPlay) set({ isLoading: true });
    },
    ready: () => {
      if (loadedId && !wantPlay) set({ isLoading: false });
    },
    ended: () => {
      if (loadedId) onEnded();
    },
    error: () => {
      if (loadedId) fail(loadToken);
    },
  });

  return {
    queue: [],
    index: -1,
    isPlaying: false,
    isLoading: false,
    positionSec: 0,
    durationSec: 0,
    volume: 0.8,
    muted: false,
    repeat: 'off',
    shuffle: false,
    order: [],
    queueTitle: undefined,

    playList(tracks, startIndex, title) {
      if (tracks.length === 0) return;
      const start = Math.min(Math.max(0, startIndex), tracks.length - 1);
      // Старт со скрытого трека («Слушать» списка, где он первый) — со следующего не скрытого.
      let index = start;
      for (let step = 1; step < tracks.length && isHidden(tracks[index]); step++) index = (start + step) % tracks.length;
      if (isHidden(tracks[index])) {
        useUi.getState().toast(ALL_HIDDEN_MESSAGE);
        return;
      }
      const s = get();
      const current = s.queue[s.index];
      const sameTrack = current && current.id === tracks[index].id && loadedId === current.id;
      failuresInRow = 0;
      const queue = { queue: tracks.slice(), order: s.shuffle ? shuffleOrder(tracks.length, index) : [], queueTitle: title };
      if (sameTrack) {
        // Тот же трек из другого списка: меняем очередь (одним изменением), не перезапуская звук.
        set({ ...queue, index });
        if (!s.isPlaying) get().toggle();
        return;
      }
      set(queue);
      startTrack(index, { autoplay: true, cause: 'user' });
    },

    playAt(index) {
      if (!get().queue[index]) return;
      failuresInRow = 0;
      startTrack(index, { autoplay: true, cause: 'user' });
    },

    toggle() {
      const s = get();
      const track = s.queue[s.index];
      if (!track) return;
      if (s.isLoading && wantPlay) {
        wantPlay = false;
        awaitingMore = false;
        clearLoadTimer();
        audioEngine.pause();
        set({ isLoading: false, isPlaying: false });
        return;
      }
      if (loadedId !== track.id) {
        startTrack(s.index, { autoplay: true, startAt: s.positionSec });
        return;
      }
      if (s.isPlaying) {
        wantPlay = false;
        audioEngine.pause();
      } else {
        wantPlay = true;
        audioEngine.play();
      }
    },

    next() {
      const n = nextPlayable(get(), true);
      if (n === null) {
        // Трек, который допишет волна, сменит текущий по «Далее» пользователя.
        pendingCause = 'user';
        waitForMore();
        return;
      }
      failuresInRow = 0;
      startTrack(n, { autoplay: true, cause: 'user' });
    },

    prev() {
      const s = get();
      if (!s.queue[s.index]) return;
      const p =
        skipHidden(s, prevIndex(queueState(s), s.positionSec), (state) => {
          const before = prevIndex(state, 0);
          return before === state.index ? null : before;
        }) ?? s.index;
      if (p === s.index) {
        get().seek(0);
        return;
      }
      failuresInRow = 0;
      startTrack(p, { autoplay: true, cause: 'user' });
    },

    seek(sec) {
      const { durationSec } = get();
      const clamped = Math.max(0, durationSec > 0 ? Math.min(sec, durationSec) : sec);
      set({ positionSec: clamped });
      if (loadedId) audioEngine.seek(clamped);
    },

    setVolume(v) {
      const volume = Math.min(1, Math.max(0, v));
      set({ volume, muted: volume === 0 ? get().muted : false });
    },

    toggleMute() {
      set({ muted: !get().muted });
    },

    cycleRepeat() {
      set({ repeat: REPEAT_CYCLE[get().repeat] });
    },

    toggleShuffle() {
      const s = get();
      const shuffle = !s.shuffle;
      set({ shuffle, order: shuffle ? shuffleOrder(s.queue.length, s.index) : [] });
    },

    appendTracks(tracks) {
      if (tracks.length === 0) {
        // Продолжения не будет: перестаём ждать. Ответ прямо из хука конца очереди — остальное решит он.
        if (awaitingMore) {
          awaitingMore = false;
          pendingCause = 'replace';
          if (endHookRunning) return;
          wantPlay = false;
          set({ isLoading: false, isPlaying: false });
        }
        return;
      }
      const s = get();
      const from = s.queue.length;
      const added = tracks.map((_, i) => from + i);
      const order = s.shuffle && s.order.length === from ? [...s.order, ...added] : s.order;
      set({ queue: [...s.queue, ...tracks], order });
      if (awaitingMore) {
        awaitingMore = false;
        const n = nextIndex(queueState(get()), true);
        if (n !== null && n !== s.index) startTrack(n, { autoplay: true });
      }
    },

    removeUpcoming(match) {
      const s = get();
      const seq = s.shuffle && s.order.length === s.queue.length ? s.order : s.queue.map((_, i) => i);
      const pos = seq.indexOf(s.index);
      const drop = new Set(seq.slice(pos + 1).filter((i) => i !== s.index && match(s.queue[i])));
      if (drop.size === 0) return;
      const newIndex: number[] = [];
      const queue: Track[] = [];
      s.queue.forEach((t, i) => {
        newIndex[i] = queue.length;
        if (!drop.has(i)) queue.push(t);
      });
      const order = s.order.length === s.queue.length ? s.order.filter((i) => !drop.has(i)).map((i) => newIndex[i]) : s.order;
      set({ queue, order, index: newIndex[s.index] });
    },

    onTrackLeave(cb) {
      leaveListeners.add(cb);
      return () => {
        leaveListeners.delete(cb);
      };
    },
  };
});

/** Следующие треки очереди в порядке «Далее» (с перемешиванием и повтором), не больше `n`, без текущего и без скрытых. */
export function upcomingTracks(s: Pick<PlayerState, 'queue' | 'index' | 'repeat' | 'shuffle' | 'order'>, n: number): Track[] {
  const out: Track[] = [];
  const seen = new Set<number>([s.index]);
  let state = queueState(s);
  while (out.length < n) {
    const next = nextIndex(state, true);
    if (next === null || seen.has(next) || !s.queue[next]) break;
    seen.add(next);
    if (!isHidden(s.queue[next])) out.push(s.queue[next]);
    state = { ...state, index: next };
  }
  return out;
}

/**
 * Попросить main готовить звук: текущий трек и, если `ahead`, следующие `PREPARE_AHEAD`. Без `ahead` (трек только
 * что сменился, пользователь может листать дальше) — текущий и уже начатые подготовки, остальные main отменяет.
 */
function requestPreparation(ahead: boolean): void {
  const s = usePlayer.getState();
  const current = s.queue[s.index];
  const next = upcomingTracks(s, PREPARE_AHEAD);
  const tracks = [current, ...(ahead ? next : next.filter((t) => preparedIds.has(t.id)))].filter((t): t is Track => !!t);
  preparedIds = new Set(tracks.map((t) => t.id));
  void Promise.resolve()
    .then(() => window.aura.prepareStreams('player', tracks))
    .catch(() => undefined);
}

/** Звук следующего трека — заранее: ссылка (main), затем начало трека во второй <audio>. */
function preloadNext(): void {
  const s = usePlayer.getState();
  const [next] = upcomingTracks(s, 1);
  if (!next) {
    preloaded = null;
    preloading = null;
    audioEngine.cancelPreload();
    return;
  }
  if (preloaded?.trackId === next.id && Date.now() - preloaded.at < PRELOAD_MAX_AGE_MS) return;
  if (preloading?.trackId === next.id) return;
  preloaded = null;
  audioEngine.cancelPreload();
  const promise = window.aura.resolveStream(next);
  const entry = { trackId: next.id, promise };
  preloading = entry;
  promise.then(
    (url) => {
      if (preloading !== entry) return;
      preloading = null;
      // Пока искали, очередь могла сдвинуться: подгружаем, только если это всё ещё следующий трек.
      if (upcomingTracks(usePlayer.getState(), 1)[0]?.id !== next.id) return;
      preloaded = { trackId: next.id, url, at: Date.now() };
      audioEngine.preload(url);
    },
    () => {
      if (preloading === entry) preloading = null;
    },
  );
}

/** Очередь изменилась, а трек играет: подготовка — по новой очереди (с паузой, чтобы не дёргать main на каждую правку). */
function refreshPreparationLater(): void {
  if (prepareTimer) clearTimeout(prepareTimer);
  prepareTimer = setTimeout(() => {
    prepareTimer = null;
    const s = usePlayer.getState();
    if (!loadedId || !s.isPlaying) return;
    requestPreparation(true);
    preloadNext();
  }, PREPARE_DEBOUNCE_MS);
}

usePlayer.subscribe((s, prev) => {
  if (s.queue !== prev.queue || s.order !== prev.order || s.repeat !== prev.repeat || s.shuffle !== prev.shuffle) refreshPreparationLater();
});

/** Текущий трек или null. */
export const selectCurrentTrack = (s: PlayerState): Track | null => s.queue[s.index] ?? null;
export const useCurrentTrack = (): Track | null => usePlayer(selectCurrentTrack);

// ---- сохранение и восстановление сессии ----

function readQueueCache(): Record<string, Track> {
  try {
    const raw = localStorage.getItem(QUEUE_CACHE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    const out: Record<string, Track> = {};
    if (Array.isArray(list)) {
      for (const t of list) {
        if (t && typeof t === 'object' && typeof (t as Track).id === 'string') out[(t as Track).id] = t as Track;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeQueueCache(queue: Track[]): void {
  try {
    localStorage.setItem(QUEUE_CACHE_KEY, JSON.stringify(queue.slice(0, QUEUE_CACHE_LIMIT)));
  } catch {
    // переполнение хранилища — сессия просто не восстановится
  }
}

function sessionOf(s: PlayerState) {
  if (s.queue.length === 0 || s.index < 0) return null;
  const queue = s.queue.slice(0, QUEUE_CACHE_LIMIT).map((t) => t.id);
  const index = Math.min(s.index, queue.length - 1);
  return { queue, index, positionSec: Math.floor(s.positionSec) };
}

function restoreSession(): void {
  const { settings } = useSettings.getState();
  const patch: Partial<PlayerState> = {
    volume: settings.volume,
    muted: settings.muted,
    repeat: settings.repeat,
    shuffle: settings.shuffle,
  };
  const session = settings.lastSession;
  if (session && session.queue.length > 0) {
    const known = { ...useLibrary.getState().lib.tracks, ...readQueueCache() };
    const currentId = session.queue[session.index];
    const queue = session.queue.map((id) => known[id]).filter((t): t is Track => Boolean(t));
    const index = queue.findIndex((t) => t.id === currentId);
    if (index >= 0) {
      Object.assign(patch, {
        queue,
        index,
        positionSec: session.positionSec,
        durationSec: queue[index].durationSec ?? 0,
        order: settings.shuffle ? shuffleOrder(queue.length, index) : [],
      });
    }
  }
  usePlayer.setState(patch);
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox' && target.type !== 'button';
}

function setupKeyboard(): void {
  // Пробел — играть/пауза везде, кроме полей ввода. keyup тоже гасим, чтобы пробел не «нажал» кнопку в фокусе.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.ctrlKey || e.altKey || e.metaKey || isTextField(e.target)) return;
    e.preventDefault();
    if (!e.repeat) usePlayer.getState().toggle();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !isTextField(e.target)) e.preventDefault();
  });
}

function setupMediaSession(): void {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  const player = () => usePlayer.getState();
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => !player().isPlaying && player().toggle()],
    ['pause', () => (player().isPlaying || player().isLoading) && player().toggle()],
    ['previoustrack', () => player().prev()],
    ['nexttrack', () => player().next()],
    ['seekto', (d) => d.seekTime != null && player().seek(d.seekTime)],
    ['seekbackward', (d) => player().seek(player().positionSec - (d.seekOffset ?? 10))],
    ['seekforward', (d) => player().seek(player().positionSec + (d.seekOffset ?? 10))],
  ];
  if (ms) {
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // действие не поддерживается — пропускаем
      }
    }
  }

  // Медиаклавиши, пойманные main-процессом (если он их перехватывает).
  window.aura.onMediaKey((key) => {
    if (key === 'play-pause') player().toggle();
    else if (key === 'next') player().next();
    else if (key === 'prev') player().prev();
  });

  let lastTrackId: string | null = null;
  usePlayer.subscribe((s) => {
    if (!ms) return;
    const track = selectCurrentTrack(s);
    if ((track?.id ?? null) !== lastTrackId) {
      lastTrackId = track?.id ?? null;
      ms.metadata = track
        ? new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album ?? '',
            artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '512x512' }] : [],
          })
        : null;
    }
    ms.playbackState = !track ? 'none' : s.isPlaying ? 'playing' : 'paused';
  });
}

function setupPersistence(): void {
  const settings = () => useSettings.getState();
  let savedPos = usePlayer.getState().positionSec;

  const saveSession = (s: PlayerState) => {
    savedPos = s.positionSec;
    settings().update({ lastSession: sessionOf(s) });
  };

  usePlayer.subscribe((s, prev) => {
    if (s.volume !== prev.volume || s.muted !== prev.muted || s.repeat !== prev.repeat || s.shuffle !== prev.shuffle) {
      settings().update({ volume: s.volume, muted: s.muted, repeat: s.repeat, shuffle: s.shuffle });
    }
    if (s.volume !== prev.volume) audioEngine.setVolume(s.volume);
    if (s.muted !== prev.muted) audioEngine.setMuted(s.muted);

    if (s.queue !== prev.queue) writeQueueCache(s.queue);
    if (
      s.queue !== prev.queue ||
      s.index !== prev.index ||
      (prev.isPlaying && !s.isPlaying) ||
      Math.abs(s.positionSec - savedPos) >= POSITION_SAVE_STEP_SEC
    ) {
      saveSession(s);
    }
  });

  // Перед закрытием окна — точная позиция: попадает в настройки до общего сброса отложенных сохранений.
  onBeforeCloseSave(() => {
    const s = usePlayer.getState();
    saveSession(loadedId ? { ...s, positionSec: audioEngine.currentTime } : s);
  });
}

let initialized = false;

/**
 * Подключает плеер к окну: восстанавливает сессию (трек, очередь, позиция на паузе, громкость,
 * повтор, перемешивание), пробел, медиаклавиши и MediaSession, сохранение настроек.
 * Вызывается один раз после загрузки настроек и библиотеки.
 */
export function initPlayer(): void {
  if (initialized) return;
  initialized = true;
  restoreSession();
  const { volume, muted } = usePlayer.getState();
  audioEngine.setVolume(volume);
  audioEngine.setMuted(muted);
  setupKeyboard();
  setupMediaSession();
  setupPersistence();
}
