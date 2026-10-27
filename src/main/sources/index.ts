// Реестр адаптеров источников и превращение их ответов в SourceResult.
// Отказ одного источника не трогает другие: ошибка становится полем `error` его результата.
import type { SourceId, SourceResult, Track } from '../../shared/types';
import { mediaUrl } from '../protocol';
import { archive } from './archive';
import { catalog } from './catalog';
import { classifyFetchError } from './http';
import { local } from './local';
import { soundcloud } from './soundcloud';
import { SOURCE_ERROR_MESSAGES, SourceError, type AdapterStreamOptions, type SourceAdapter, type SourceContext, type StreamOptions } from './types';
import { youtube } from './youtube';

export type SourceOperation = 'search' | 'featured' | 'byTag';

const ADAPTERS: Record<SourceId, SourceAdapter> = {
  archive,
  youtube,
  soundcloud,
  local,
  catalog,
};

export function getAdapter(id: SourceId): SourceAdapter {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new SourceError('unknown', 'Неизвестный источник');
  return adapter;
}

function toSourceError(err: unknown): SourceError {
  if (err instanceof SourceError) return err;
  const classified = classifyFetchError(err);
  return classified.kind === 'unknown' ? new SourceError('unknown', SOURCE_ERROR_MESSAGES.unknown) : classified;
}

/** Выполняет запрос к источнику; любая ошибка — `{ tracks: [], error }`, исключение не выходит. */
export async function toSourceResult(source: SourceId, run: () => Promise<Track[]>): Promise<SourceResult> {
  try {
    return { source, tracks: await run() };
  } catch (err) {
    const e = toSourceError(err);
    return { source, tracks: [], error: { kind: e.kind, message: e.message } };
  }
}

export function querySource(source: SourceId, op: SourceOperation, arg: string, ctx: SourceContext): Promise<SourceResult> {
  return toSourceResult(source, async () => {
    if (source === 'youtube' && !ctx.settings.youtubeEnabled) throw new SourceError('disabled', 'YouTube выключен в настройках');
    if (source === 'soundcloud' && !ctx.settings.soundcloudEnabled) throw new SourceError('disabled', 'SoundCloud выключен в настройках');
    const adapter = getAdapter(source);
    if (op === 'search') return arg.trim() ? adapter.search(arg.trim(), ctx) : [];
    if (op === 'featured') return adapter.featured ? adapter.featured(ctx) : [];
    return adapter.byTag ? adapter.byTag(arg, ctx) : [];
  });
}

/** Путь скачанной копии трека (если файл есть на диске). Подключает очередь загрузок. */
type DownloadedLookup = (trackId: string) => Promise<string | null>;
let downloadedLookup: DownloadedLookup = async () => null;

export function setDownloadedLookup(fn: DownloadedLookup): void {
  downloadedLookup = fn;
}

/**
 * URL потока для `<audio>`; ошибка — SourceError с человеческим текстом.
 * Скачанная копия важнее потока: играет из файла и без сети, и при сети.
 * `opts.fresh` — повторная попытка плеера: адаптер не берёт сохранённую ссылку; `opts.signal` — отмена (yt-dlp убивается).
 */
export async function resolveStream(track: Track, ctx: SourceContext, opts: AdapterStreamOptions = {}): Promise<string> {
  const downloaded = await downloadedLookup(track.id).catch(() => null);
  if (downloaded) return mediaUrl(downloaded);
  try {
    return await getAdapter(track.source).resolveStream(track, ctx, opts);
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err;
    throw toSourceError(err);
  }
}

// ---------- Подготовка звука заранее ----------

/** Сколько треков одного владельца готовится вперёд (текущий и ещё до трёх). */
export const MAX_PREPARE_PER_OWNER = 4;
/** Фоновых подготовок одновременно: остальные ждут, текущий трек (прямой запрос) — без очереди. */
export const MAX_PREPARE_RUNNING = 2;

export interface StreamPreparer {
  /**
   * Эти треки владельцу нужны скоро (плеер — текущий и следующие, волна — проверяемые): звук ищется заранее.
   * Новый вызов заменяет набор владельца; подготовки, которые больше никому не нужны, отменяются (yt-dlp убивается).
   */
  prepare(owner: string, tracks: readonly Track[], opts?: { verify?: boolean }): void;
  /** Ссылка на звук: к идущей подготовке этого трека — без второго запуска; `fresh` — заново. */
  resolve(track: Track, opts?: StreamOptions): Promise<string>;
}

interface PrepareJob {
  track: Track;
  controller: AbortController;
  running: boolean;
  /** Его ждут напрямую (текущий трек) — работает вне очереди фоновых. */
  direct: boolean;
  /** Проверить ссылку (подготовка волны). */
  verify?: boolean;
  /**
   * Его уже брал в свой набор какой-то владелец. Прямой запрос, который ещё никто не взял (его `prepare` идёт
   * следом), чужая подготовка не отменяет; взятый — отменяется, когда от него отказались все владельцы.
   */
  claimed: boolean;
  promise: Promise<string>;
  resolve(url: string): void;
  reject(err: unknown): void;
}

const abortError = () => new DOMException('Aborted', 'AbortError');

/**
 * Подготовка ссылок на звук для плеера и волны: одна работа на трек, фоновых — не больше `MAX_PREPARE_RUNNING`,
 * устаревшие отменяются. Готовые ссылки остаются в кэшах адаптеров (до срока ссылки), так что следующий запрос
 * отвечает сразу.
 */
export function createStreamPreparer(
  resolveTrack: (track: Track, opts: AdapterStreamOptions) => Promise<string>,
  limits: { running?: number; perOwner?: number } = {},
): StreamPreparer {
  const maxRunning = limits.running ?? MAX_PREPARE_RUNNING;
  const perOwner = limits.perOwner ?? MAX_PREPARE_PER_OWNER;
  const wants = new Map<string, Set<string>>();
  const jobs = new Map<string, PrepareJob>();

  function makeJob(track: Track): PrepareJob {
    let resolve!: (url: string) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined); // фоновую подготовку никто не ждёт — её неудача не «необработанная»
    return { track, controller: new AbortController(), running: false, direct: false, claimed: false, promise, resolve, reject };
  }

  function start(job: PrepareJob, fresh = false): void {
    job.running = true;
    resolveTrack(job.track, { fresh, verify: job.verify, signal: job.controller.signal })
      .then(job.resolve, job.reject)
      .finally(() => {
        if (jobs.get(job.track.id) === job) jobs.delete(job.track.id);
        pump();
      });
  }

  function pump(): void {
    let running = [...jobs.values()].filter((j) => j.running && !j.direct).length;
    for (const job of jobs.values()) {
      if (running >= maxRunning) break;
      if (job.running) continue;
      start(job);
      running++;
    }
  }

  function cancel(job: PrepareJob): void {
    if (jobs.get(job.track.id) === job) jobs.delete(job.track.id);
    job.controller.abort();
    job.reject(abortError());
  }

  const wanted = (id: string): boolean => [...wants.values()].some((s) => s.has(id));

  return {
    prepare(owner, tracks, opts = {}) {
      const list = tracks.filter((t) => t && typeof t.id === 'string').slice(0, perOwner);
      wants.set(owner, new Set(list.map((t) => t.id)));
      for (const job of [...jobs.values()]) {
        if (wanted(job.track.id)) job.claimed = true;
        // Прямой запрос, который ещё не попал ни в один набор, ждёт своего владельца — не отменяем.
        else if (!job.direct || job.claimed) cancel(job);
      }
      for (const t of list) {
        if (jobs.has(t.id)) continue;
        const job = makeJob(t);
        job.claimed = true;
        if (opts.verify) job.verify = true;
        jobs.set(t.id, job);
      }
      pump();
    },

    resolve(track, opts = {}) {
      const existing = jobs.get(track.id);
      if (existing && !opts.fresh) {
        existing.direct = true;
        if (opts.verify && !existing.running) existing.verify = true;
        if (!existing.running) start(existing);
        pump();
        return existing.promise;
      }
      if (existing) cancel(existing);
      const job = makeJob(track);
      job.direct = true;
      if (opts.verify) job.verify = true;
      jobs.set(track.id, job);
      start(job, !!opts.fresh);
      return job.promise;
    },
  };
}
