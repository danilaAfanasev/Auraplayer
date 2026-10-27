// Звук приложения: один играющий <audio> и один предзагрузочный (следующий трек подгружается заранее,
// чтобы «Далее» звучало сразу). Плеер (usePlayer) управляет ими только через этот модуль; события
// отдаёт только играющий элемент — предзагрузка плеер не трогает.

export interface AudioEngineEvents {
  time(sec: number): void;
  duration(sec: number): void;
  playing(): void;
  paused(): void;
  waiting(): void;
  /** Данных хватает, чтобы начать (canplay). */
  ready(): void;
  ended(): void;
  error(): void;
}

/** Играющий элемент. */
let active: HTMLAudioElement | null = null;
/** Предзагрузочный: следующий трек грузится в нём на паузе и без звука, потом элементы меняются местами. */
let spare: HTMLAudioElement | null = null;
/** Что сейчас подгружает предзагрузочный элемент; null — ничего. */
let spareUrl: string | null = null;
/** Предзагрузка сорвалась (ссылка не открылась) — при переходе грузим заново. */
let spareFailed = false;
let handlers: Partial<AudioEngineEvents> = {};
/** Позиция, с которой начать после загрузки метаданных. */
let pendingStart = 0;
/** Номер загрузки: ответ play() от прошлого трека не должен влиять на новый. */
let loadSeq = 0;
let volume = 1;
let muted = false;

function create(): HTMLAudioElement {
  const el = new Audio();
  el.preload = 'auto';
  const on = (type: string, fn: () => void) => el.addEventListener(type, () => el === active && fn());

  on('timeupdate', () => handlers.time?.(el.currentTime));
  on('durationchange', () => {
    if (Number.isFinite(el.duration) && el.duration > 0) handlers.duration?.(el.duration);
  });
  on('loadedmetadata', applyPendingStart);
  on('playing', () => handlers.playing?.());
  on('pause', () => handlers.paused?.());
  on('waiting', () => handlers.waiting?.());
  on('canplay', () => handlers.ready?.());
  on('ended', () => handlers.ended?.());
  el.addEventListener('error', () => {
    if (el === spare) {
      if (el.getAttribute('src')) spareFailed = true;
      return;
    }
    // Пустой src (после stop) — не ошибка трека.
    if (el === active && el.getAttribute('src')) handlers.error?.();
  });
  return el;
}

function element(): HTMLAudioElement {
  active ??= create();
  return active;
}

function applyPendingStart(): void {
  const el = element();
  if (pendingStart > 0 && Number.isFinite(el.duration) && pendingStart < el.duration) el.currentTime = pendingStart;
  pendingStart = 0;
}

function clear(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute('src');
  el.load();
}

function playSafely(el: HTMLAudioElement): void {
  const seq = loadSeq;
  el.play().catch((err: unknown) => {
    if (seq !== loadSeq) return;
    const name = (err as { name?: string } | null)?.name;
    // AbortError — play() прервала пауза; NotSupportedError — источник недоступен, об этом сообщит событие error.
    if (name === 'AbortError' || name === 'NotSupportedError') return;
    handlers.paused?.();
  });
}

export const audioEngine = {
  on(events: Partial<AudioEngineEvents>): void {
    handlers = events;
  },

  /**
   * Загружает трек; `startAt` — позиция в секундах, `autoplay` — сразу играть.
   * Этот URL уже подгружен предзагрузкой — элементы меняются местами, звук идёт сразу.
   */
  load(url: string, startAt = 0, autoplay = true): void {
    loadSeq++;
    pendingStart = startAt > 0 ? startAt : 0;
    if (spare && spareUrl === url && !spareFailed) {
      const previous = element();
      active = spare;
      spare = previous;
      spareUrl = null;
      clear(previous);
      const el = active;
      el.volume = volume;
      el.muted = muted;
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
        applyPendingStart();
        if (Number.isFinite(el.duration) && el.duration > 0) handlers.duration?.(el.duration);
      }
      if (autoplay) playSafely(el);
      else if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) handlers.ready?.();
      return;
    }
    const el = element();
    el.src = url;
    el.load();
    if (autoplay) playSafely(el);
  },

  /** Подгрузить начало следующего трека заранее (на паузе, без звука); играющий трек не трогается. */
  preload(url: string): void {
    if (spareUrl === url && !spareFailed) return;
    spare ??= create();
    spareFailed = false;
    spareUrl = url;
    spare.muted = true;
    spare.src = url;
    spare.load();
  },

  /** Предзагрузка больше не нужна (очередь сменилась): освободить соединение. */
  cancelPreload(): void {
    if (!spare || spareUrl === null) return;
    spareUrl = null;
    spareFailed = false;
    clear(spare);
  },

  play(): void {
    const el = element();
    if (el.getAttribute('src')) playSafely(el);
  },

  pause(): void {
    active?.pause();
  },

  /** Снимает трек (очередь закончилась или трек недоступен). */
  stop(): void {
    if (!active) return;
    loadSeq++;
    clear(active);
  },

  seek(sec: number): void {
    const el = element();
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) el.currentTime = Math.max(0, sec);
    else pendingStart = Math.max(0, sec);
  },

  setVolume(v: number): void {
    volume = Math.min(1, Math.max(0, v));
    element().volume = volume;
  },

  setMuted(m: boolean): void {
    muted = m;
    element().muted = m;
  },

  get currentTime(): number {
    return active?.currentTime ?? 0;
  },
};
