// Волна: бесконечные похожие треки. Очередь плеера сама дополняется, когда до конца остаётся ~3 трека;
// без дублей, один исполнитель не больше 2 раз подряд, «Не нравится» исключает трек и исполнителя
// (отбор — shared/wave.ts, кандидаты — main через aura.wave). Волна — обычная очередь плеера:
// заменил очередь другим списком — волна выключилась. В «Мои плейлисты» она сама не попадает.
// В очередь трек встаёт, только когда его звук найден (проверка наперёд — `feed`); без звука — тихо выкидывается.
import { create } from 'zustand';
import type { WaveSeed } from '../../shared/api';
import { artistKey } from '../../shared/artistNames';
import { isBlocked, withoutBlocked, type Blacklist } from '../../shared/blacklist';
import type { LibraryData, Track } from '../../shared/types';
import {
  emptyWaveMemory,
  isBanned,
  pickWaveTracks,
  artistsKey,
  rememberTracks,
  songKey,
  type WaveMemory,
} from '../../shared/wave';
import { errorMessage } from '../app/errors';
import { dislikeTrack } from './blacklistActions';
import { useLibrary } from './useLibrary';
import { setQueueEndHook, usePlayer, WAIT_SOURCES, type PlayerState } from './usePlayer';
import { useSettings } from './useSettings';
import { useUi } from './useUi';

/** До конца очереди осталось столько треков (или меньше) — пора дописывать. */
export const WAVE_REFILL_AT = 3;
/** Треков в одной порции. */
const BATCH = 15;
/** Столько попыток подряд дают только повторы — порция пропускается. */
const ATTEMPTS = 3;
/** Сколько последних треков очереди — сиды дополнения. */
const RECENT = 3;
/** Звук треков волны проверяется заранее: не больше стольких сразу… */
const CHECK_PARALLEL = 2;
/** …и пока впереди в очереди (с проверяемыми) меньше стольких — дальше не нужно. */
const CHECK_AHEAD = 4;

/** «Волна по треку»: этот трек, дальше — похожие. */
export function trackWaveSeed(track: Track): WaveSeed {
  return { title: track.title, lead: [track], tracks: [track] };
}

/** «Волна по артисту»: его популярный трек первым, дальше — его треки и похожие. */
export function artistWaveSeed(name: string, topTracks: readonly Track[]): WaveSeed {
  const [first, ...rest] = topTracks;
  return { title: name, artists: [name], ...(first ? { lead: [first], extra: rest.slice() } : {}) };
}

/** «Своя волна»: любой артист или жанр текстом. */
export function textWaveSeed(text: string): WaveSeed {
  return { title: text.trim(), text: text.trim() };
}

export const SOUNDCLOUD_WAVE_TITLE = 'Волна SoundCloud';
const SC_WAVE_SEEDS = 4;

/**
 * «Волна SoundCloud» раздела SoundCloud: похожие (рекомендации SoundCloud) на недавно слушанные треки SoundCloud,
 * затем на лайки SoundCloud; их нет — на первый трек популярного (`fallback`). Нечего взять — null.
 */
export function soundcloudWaveSeed(lib: LibraryData, fallback: readonly Track[]): WaveSeed | null {
  const recent = lib.history.map((h) => lib.tracks[h.trackId]);
  const liked = lib.likes.map((id) => lib.tracks[id]);
  const tracks: Track[] = [];
  for (const t of [...recent, ...liked]) {
    if (t?.source === 'soundcloud' && !tracks.some((x) => x.id === t.id) && tracks.length < SC_WAVE_SEEDS) tracks.push(t);
  }
  const first = fallback.find((t) => t.source === 'soundcloud');
  if (tracks.length === 0 && first) tracks.push(first);
  return tracks.length > 0 ? { title: SOUNDCLOUD_WAVE_TITLE, tracks } : null;
}

export interface WaveState {
  /** Играющая волна; null — обычная очередь. */
  active: { title: string } | null;
  /** Какая кнопка запускает волну сейчас (ключ вызывающего) — для индикатора. */
  starting: string | null;
  /** Подбираются следующие треки. */
  refilling: boolean;
  /** Включить волну. `key` — кто включает (кнопка/чип), чтобы показать загрузку на нём. */
  start(seed: WaveSeed, key?: string): Promise<void>;
  /** Выключить волну: очередь становится обычной. */
  stop(): void;
  /** «Не нравится» на играющем треке: он уходит в чёрный список (навсегда, см. `dislikeTrack`), волна играет дальше. */
  dislike(): void;
}

// ---- состояние волны вне стора (не нужно для отрисовки) ----
let seed: WaveSeed | null = null;
let memory: WaveMemory = emptyWaveMemory();
let round = 0;
/** Номер волны: ответы прошлой (выключенной) волны отбрасываются. */
let generation = 0;
/** Очередь, которую волна поставила сама; другая очередь в плеере — пользователь включил другой список. */
let ownQueue: Track[] | null = null;
/** Волна сама меняет очередь — подписка не должна принять это за чужой список. */
let mutating = false;
let fetching = false;
/** Дополнение не удалось на этом треке — не повторяем, пока очередь не сдвинется. */
let failedAt: string | null = null;
/** Идёт первый подбор (`aura.wave.start`): дополнение ждёт его ответа. */
let startPending = false;
/** Очередь плеера в момент нажатия волны без лид-треков; сменилась до первого трека — волна отменяется. */
let pendingQueue: Track[] | null = null;
/** Очередь, на которой пользователь сам выключил волну: в её конце похожие сами не включаются. */
let declinedQueue: Track[] | null = null;
/** Отобранные треки, ещё не проверенные на звук (по порядку). */
let pool: Track[] = [];
/** Идущие проверки по порядку очереди: в очередь трек встаёт, когда проверены все до него. */
let checks: { track: Track; ok: Promise<boolean> }[] = [];
let draining = false;
/** Волна без лид-треков ещё не в плеере: первый проверенный трек заменит очередь. */
let firstPending = false;
/** Название волны, которая включится с первым проверенным треком. */
let pendingTitle = '';

function player(): PlayerState {
  return usePlayer.getState();
}

/** Постоянный чёрный список пользователя. */
function blacklist(): Blacklist {
  return useLibrary.getState().lib.blacklist;
}

const addNew = (list: string[], add: string[]): string[] => {
  const fresh = add.filter((x) => x && !list.includes(x));
  return fresh.length > 0 ? [...list, ...fresh] : list;
};

/**
 * Память волны с чёрным списком: скрытые треки — как «уже были» (по id и по песне, чтобы не вернулась
 * та же песня из другого источника), скрытые исполнители — как «Не нравится» (в том числе на фитах).
 */
export function withBlacklist(memory: WaveMemory, bl: Blacklist): WaveMemory {
  if (bl.tracks.length === 0 && bl.artists.length === 0) return memory;
  return {
    ...memory,
    bannedIds: addNew(memory.bannedIds, bl.tracks.map((b) => b.track.id)),
    songs: addNew(memory.songs, bl.tracks.map((b) => b.songKey || songKey(b.track))),
    bannedArtists: addNew(memory.bannedArtists, bl.artists.map((a) => a.key || artistKey(a.name))),
  };
}

/** Очередь `next` — это `prev` без некоторых треков (те же объекты в том же порядке): удаление, а не другой список. */
function isRemovalOf(next: readonly Track[], prev: readonly Track[]): boolean {
  if (next.length === 0 || next.length >= prev.length) return false;
  let j = 0;
  for (const t of prev) if (j < next.length && next[j] === t) j++;
  return j === next.length;
}

/** Трек не встаёт в волну: «Не нравится» этой волны или чёрный список. */
const isOut = (track: Track): boolean => isBanned(track, memory) || isBlocked(track, blacklist());

/** Изменить очередь от имени волны. */
function ownChange(fn: () => void): void {
  mutating = true;
  try {
    fn();
  } finally {
    mutating = false;
  }
  ownQueue = player().queue;
}

/** Сколько треков ещё впереди (с учётом перемешивания). */
function remaining(s: PlayerState): number {
  if (s.shuffle && s.order.length === s.queue.length) {
    const pos = s.order.indexOf(s.index);
    return pos < 0 ? 0 : s.order.length - 1 - pos;
  }
  return Math.max(0, s.queue.length - 1 - s.index);
}

/** Отобранные, но ещё не вставшие в очередь (проверяются или ждут проверки). */
function pendingTracks(): Track[] {
  return [...checks.map((c) => c.track), ...pool];
}

/** Память волны о «хвосте» — по фактической очереди и ждущим проверки (после «Не нравится» она могла измениться). */
function syncTail(queue: readonly Track[]): void {
  memory = { ...memory, tail: [...queue, ...pendingTracks()].slice(-2).map(artistsKey) };
}

/** Звук этих треков ищет yt-dlp (каталог, YouTube, SoundCloud) — он может не найтись; остальные играют по ссылке. */
const needsCheck = (t: Track): boolean => WAIT_SOURCES.includes(t.source);

/** Main готовит звук проверяемых треков (owner «wave»); остальные проверки волны он отменяет. */
function syncChecking(): void {
  const list = checks.filter((c) => needsCheck(c.track)).map((c) => c.track);
  void Promise.resolve()
    .then(() => window.aura.prepareStreams('wave', list))
    .catch(() => undefined);
}

/** Есть ли у трека звук: main ищет его так же, как перед проигрыванием (найденная ссылка остаётся в кэше). */
async function hasSound(track: Track): Promise<boolean> {
  if (!needsCheck(track)) return true;
  try {
    await window.aura.resolveStream(track, { verify: true });
    return true;
  } catch {
    return false;
  }
}

export const useWave = create<WaveState>((set, get) => {
  function toastError(err: unknown): void {
    useUi.getState().toast(`Волна: ${errorMessage(err)}`, undefined, 'error');
  }

  /**
   * Проверка звука наперёд: треки из `pool` проверяются по порядку (не больше `CHECK_PARALLEL` сразу и пока впереди
   * меньше `CHECK_AHEAD`), проверенный встаёт в очередь, без звука — тихо выкидывается, его место займёт следующий.
   */
  function feed(): void {
    if (!seed) return;
    let running = checks.filter((c) => needsCheck(c.track)).length;
    const ahead = () => (firstPending ? 0 : remaining(player())) + checks.length;
    let started = false;
    while (pool.length > 0) {
      const next = pool[0];
      if (needsCheck(next)) {
        if (running >= CHECK_PARALLEL || ahead() >= CHECK_AHEAD) break;
        running++;
      }
      pool.shift();
      const ok = hasSound(next);
      checks.push({ track: next, ok });
      started = true;
    }
    if (started) syncChecking();
    if (checks.length > 0 && !draining) void drain(generation);
    else if (checks.length === 0 && pool.length === 0) maybeRefill(player());
  }

  async function drain(gen: number): Promise<void> {
    draining = true;
    let changed = false;
    try {
      while (checks.length > 0) {
        const head = checks[0];
        const ok = await head.ok;
        if (gen !== generation) return;
        checks.shift();
        changed = true;
        if (ok && !isOut(head.track)) deliver(head.track);
        feed();
      }
    } finally {
      if (gen === generation) draining = false;
    }
    if (changed) syncChecking();
    if (gen === generation && checks.length === 0 && pool.length === 0) {
      if (firstPending) {
        // Ни у одного подобранного трека не нашлось звука — волна не включается.
        useUi.getState().toast('Волна: не удалось подобрать треки — попробуй другую', undefined, 'error');
        reset();
        return;
      }
      maybeRefill(player());
    }
  }

  /** Проверенный трек — в очередь: первый у волны без лид-треков заменяет очередь, остальные дописываются. */
  function deliver(track: Track): void {
    if (firstPending) {
      firstPending = false;
      pendingQueue = null;
      set({ active: { title: pendingTitle }, starting: null });
      ownChange(() => player().playList([track], 0));
      return;
    }
    ownChange(() => player().appendTracks([track]));
  }

  async function refill(): Promise<void> {
    // Первый подбор ещё идёт: второй параллельный не нужен, его ответ и допишет очередь.
    if (!seed || fetching || startPending) return;
    // Отобранные ещё проверяются — продолжения ждать от них.
    if (pool.length > 0 || checks.length > 0) {
      feed();
      return;
    }
    const gen = generation;
    const s = player();
    const atId = s.queue[s.index]?.id ?? null;
    if (failedAt !== null && failedAt === atId) {
      player().appendTracks([]);
      return;
    }
    fetching = true;
    set({ refilling: true });
    let lastError: unknown = null;
    let picked: Track[] = [];
    try {
      const recent = s.queue.slice(Math.max(0, s.index - RECENT + 1), s.index + 1).filter((t) => !isBanned(t, memory));
      for (let attempt = 0; attempt < ATTEMPTS && picked.length === 0; attempt++) {
        try {
          const candidates = await window.aura.wave.more({ seed, recent, round: round++ });
          if (gen !== generation) return;
          syncTail(player().queue);
          const result = pickWaveTracks(candidates, memory, BATCH);
          memory = result.memory;
          picked = result.picked;
        } catch (err) {
          if (gen !== generation) return;
          lastError = err;
        }
      }
    } finally {
      if (gen === generation) {
        fetching = false;
        set({ refilling: false });
      }
    }
    if (gen !== generation) return;
    if (picked.length === 0) {
      failedAt = atId;
      if (lastError) toastError(lastError);
      player().appendTracks([]); // если плеер ждал продолжения — перестаёт
      return;
    }
    failedAt = null;
    pool.push(...picked);
    feed();
  }

  function maybeRefill(s: PlayerState): void {
    if (!seed || fetching || startPending || s.index < 0) return;
    if (remaining(s) + checks.length + pool.length < WAVE_REFILL_AT) void refill();
  }

  // Волна следит за очередью: чужой список — выключиться; трек сменился — проверить следующие, подходит конец — дописать.
  usePlayer.subscribe((s, prev) => {
    if (mutating) return;
    if (pendingQueue && s.queue !== pendingQueue) {
      // Волна ещё подбиралась, а пользователь включил другой список — его очередь главнее.
      reset();
      return;
    }
    if (!get().active) return;
    if (s.queue !== ownQueue) {
      // Убрали будущие треки снаружи («Убрать из очереди», «Не нравится», чёрный список) — это всё ещё волна.
      if (ownQueue && isRemovalOf(s.queue, ownQueue)) {
        ownQueue = s.queue;
      } else {
        reset();
        return;
      }
    }
    if (s.index !== prev.index || s.queue !== prev.queue) {
      feed();
      maybeRefill(s);
    }
  });

  /** Волна выключается: очередь плеера остаётся как есть, но уже обычная. */
  function reset(): void {
    generation++;
    seed = null;
    ownQueue = null;
    fetching = false;
    startPending = false;
    pendingQueue = null;
    failedAt = null;
    const hadChecks = checks.length > 0;
    pool = [];
    checks = [];
    draining = false;
    firstPending = false;
    if (hadChecks) syncChecking();
    set({ active: null, starting: null, refilling: false });
    player().appendTracks([]);
  }

  /**
   * «Похожие после конца списка»: обычная очередь доиграла (повтор выключен) — волна похожих на последний трек.
   * Вызывается из хука конца очереди, синхронно: true — продолжение будет, плеер ждёт.
   */
  function continueAfterQueue(): boolean {
    const s = player();
    const { settings } = useSettings.getState();
    if (!settings.waveAfterQueue || s.repeat !== 'off') return false;
    if (seed || startPending || s.queue === declinedQueue) return false;
    const last = s.queue[s.index];
    if (!last) return false;
    // Похожие на трек SoundCloud — рекомендации SoundCloud, остальным нужен YouTube.
    if (last.source === 'soundcloud' ? !settings.soundcloudEnabled : !settings.youtubeEnabled) return false;

    generation++;
    const gen = generation;
    const title = `похожие на ${last.title}`;
    const continued: WaveSeed = { title, tracks: [last] };
    seed = continued;
    memory = rememberTracks(withBlacklist(emptyWaveMemory(), blacklist()), s.queue);
    round = 0;
    failedAt = null;
    ownQueue = s.queue;
    startPending = true;
    set({ active: { title }, starting: null });

    void (async () => {
      let picked: Track[] = [];
      try {
        const candidates = await window.aura.wave.start(continued);
        if (gen !== generation) return;
        syncTail(player().queue);
        const result = pickWaveTracks(candidates, memory, BATCH * 2);
        memory = result.memory;
        picked = result.picked;
      } catch (err) {
        if (gen !== generation) return;
        toastError(err);
      }
      if (gen !== generation) return;
      startPending = false;
      if (picked.length === 0) {
        reset(); // плеер перестаёт ждать и останавливается, как без волны
        return;
      }
      pool.push(...picked);
      feed();
    })();
    return true;
  }

  // Чёрный список пополнился (здесь, в панели плеера, на странице артиста): скрытое уходит из памяти, отобранного и будущей
  // части очереди — от имени волны, чтобы она не приняла правку за чужой список и не выключилась.
  useLibrary.subscribe((s, prev) => {
    if (s.lib.blacklist === prev.lib.blacklist || !seed) return;
    memory = withBlacklist(memory, s.lib.blacklist);
    pool = pool.filter((t) => !isOut(t));
    if (get().active && player().queue === ownQueue) ownChange(() => player().removeUpcoming(isOut));
  });

  // Конец очереди: играет волна — дописать (или дождаться проверки отобранных); доиграл обычный список — похожие.
  setQueueEndHook(() => {
    if (get().active) {
      void refill();
      return true;
    }
    return continueAfterQueue();
  });

  function stop(): void {
    // Пользователь выключил волну — эта очередь в своём конце не продолжится похожими сама.
    reset();
    declinedQueue = player().queue;
  }

  return {
    active: null,
    starting: null,
    refilling: false,

    async start(nextSeed, key) {
      reset();
      const gen = generation;
      seed = nextSeed;
      memory = withBlacklist(emptyWaveMemory(), blacklist());
      round = 0;
      const lead = withoutBlocked(nextSeed.lead ?? [], blacklist(), (t) => t);
      // С сидами-треками музыка начинается сразу — индикатор на кнопке не нужен.
      set({ starting: lead.length > 0 ? null : (key ?? null) });

      if (lead.length > 0) {
        // Сиды-треки играют сразу, похожие подбираются, пока они звучат.
        memory = rememberTracks(memory, lead);
        set({ active: { title: nextSeed.title } });
        ownChange(() => player().playList(lead, 0));
      }

      // Без лид-треков очередь пока прежняя: сменит её пользователь до первого трека — волна отменяется (см. подписку).
      pendingQueue = lead.length > 0 ? null : player().queue;
      startPending = true;
      let picked: Track[] = [];
      try {
        const candidates = await window.aura.wave.start(nextSeed);
        if (gen !== generation) return;
        syncTail(lead.length > 0 ? player().queue : []);
        const result = pickWaveTracks(candidates, memory, BATCH * 2);
        memory = result.memory;
        picked = result.picked;
      } catch (err) {
        if (gen !== generation) return;
        toastError(err);
        if (lead.length === 0) {
          reset();
          return;
        }
      }
      if (gen !== generation) return;
      startPending = false;

      if (lead.length > 0) {
        // Плеер мог дойти до конца лид-треков и ждать: проверенное заиграет само, пустое — дополнит refill.
        pool.push(...picked);
        if (picked.length > 0) feed();
        else maybeRefill(player());
        return;
      }
      if (picked.length === 0) {
        useUi.getState().toast('Волна: не удалось подобрать треки — попробуй другую', undefined, 'error');
        reset();
        return;
      }
      // Первый трек с найденным звуком заменит очередь (до этого кнопка показывает загрузку).
      firstPending = true;
      pendingTitle = nextSeed.title;
      pool.push(...picked);
      feed();
    },

    stop,

    dislike() {
      const s = player();
      const track = s.queue[s.index];
      if (!track) return;
      // Память, отобранное и очередь волна чистит сама — по изменению чёрного списка (подписка выше).
      dislikeTrack(track);
      if (get().active) maybeRefill(player());
    },
  };
});
