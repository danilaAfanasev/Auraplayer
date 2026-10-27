// Поиск, подборки и потоки: IPC-обработчики над адаптерами источников (`src/main/sources/`).
import { app } from 'electron';
import type { PrepareOwner, StreamOptions } from '../../shared/api';
import { IPC } from '../../shared/ipc';
import { isRetiredTrack } from '../../shared/library';
import { SOURCE_IDS, type SourceId, type SourceResult, type Track } from '../../shared/types';
import { getSettings } from '../settingsStore';
import { createStreamPreparer, querySource, resolveStream } from '../sources';
import type { SourceContext } from '../sources/types';
import { assertString, handle, UserError } from './handle';

async function context(): Promise<SourceContext> {
  return { settings: await getSettings(), userDataDir: app.getPath('userData') };
}

function assertSource(source: unknown): asserts source is SourceId {
  if (!SOURCE_IDS.includes(source as SourceId)) throw new UserError('Неизвестный источник');
}

/** Источник убран из приложения (Jamendo), а трек остался в лайках, плейлистах или «Скачанном». */
export const RETIRED_SOURCE_MESSAGE = 'Этот источник больше не поддерживается — трек играет, только если он скачан';

/** Трек для потока: источник может быть и прежним (Jamendo) — скачанная копия ищется раньше адаптера. */
function assertStreamTrack(track: unknown): asserts track is Track {
  const t = track as Partial<Track> | null;
  if (!t || typeof t.sourceId !== 'string' || typeof t.id !== 'string' || typeof t.source !== 'string' || !t.source) {
    throw new UserError('Неверный трек');
  }
}

const PREPARE_OWNERS: readonly PrepareOwner[] = ['player', 'wave'];

/** Подготовка звука заранее и потоки плеера: одна работа на трек, устаревшие отменяются. */
const preparer = createStreamPreparer(async (track, opts) => resolveStream(track, await context(), opts));

const isStreamTrack = (t: unknown): t is Track => {
  try {
    assertStreamTrack(t);
    return true;
  } catch {
    return false;
  }
};

export function registerSourcesIpc(): void {
  handle(IPC.sources.search, async (source: SourceId, query: string): Promise<SourceResult> => {
    assertSource(source);
    assertString(query, 'query');
    return querySource(source, 'search', query, await context());
  });

  handle(IPC.sources.featured, async (source: SourceId): Promise<SourceResult> => {
    assertSource(source);
    return querySource(source, 'featured', '', await context());
  });

  handle(IPC.sources.byTag, async (source: SourceId, tag: string): Promise<SourceResult> => {
    assertSource(source);
    assertString(tag, 'tag');
    return querySource(source, 'byTag', tag, await context());
  });

  handle(IPC.sources.prepare, async (owner: PrepareOwner, tracks: Track[]): Promise<void> => {
    if (!PREPARE_OWNERS.includes(owner)) throw new UserError('Неверный параметр: owner');
    // Волна проверяет, что звук правда есть: ссылка проверяется запросом первых байт.
    preparer.prepare(owner, Array.isArray(tracks) ? tracks.filter(isStreamTrack) : [], { verify: owner === 'wave' });
  });

  handle(IPC.sources.resolveStream, async (track: Track, opts?: StreamOptions): Promise<string> => {
    assertStreamTrack(track);
    const fresh = typeof opts === 'object' && opts !== null && opts.fresh === true;
    const verify = typeof opts === 'object' && opts !== null && opts.verify === true;
    try {
      return await preparer.resolve(track, { fresh, verify });
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name === 'AbortError') throw new UserError('Загрузка отменена', 'aborted');
      if (!SOURCE_IDS.includes(track.source) || isRetiredTrack(track)) throw new UserError(RETIRED_SOURCE_MESSAGE);
      throw new UserError(err instanceof Error && err.message ? err.message : 'Трек недоступен');
    }
  });
}
