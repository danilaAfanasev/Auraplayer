// Волна: первая порция и дополнения похожих треков (`src/main/wave.ts`).
import type { WaveMoreRequest, WaveSeed } from '../../shared/api';
import { IPC } from '../../shared/ipc';
import { SOURCE_IDS, type SourceId, type Track } from '../../shared/types';
import { getSettings } from '../settingsStore';
import { SourceError } from '../sources/types';
import { wave } from '../wave';
import { handle, UserError } from './handle';

const MAX_TRACKS = 50;
const MAX_NAMES = 30;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanTracks(v: unknown): Track[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter(
      (t): t is Track =>
        isObject(t) &&
        typeof t.id === 'string' &&
        typeof t.sourceId === 'string' &&
        typeof t.title === 'string' &&
        typeof t.artist === 'string' &&
        SOURCE_IDS.includes(t.source as SourceId),
    )
    .slice(-MAX_TRACKS);
}

function cleanNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').slice(0, MAX_NAMES);
}

function cleanSeed(v: unknown): WaveSeed {
  if (!isObject(v) || typeof v.title !== 'string') throw new UserError('Неверный параметр: волна');
  const seed: WaveSeed = { title: v.title };
  const lead = cleanTracks(v.lead);
  const tracks = cleanTracks(v.tracks);
  const extra = cleanTracks(v.extra);
  const artists = cleanNames(v.artists);
  const queries = cleanNames(v.queries);
  if (lead) seed.lead = lead;
  if (tracks) seed.tracks = tracks;
  if (extra) seed.extra = extra;
  if (artists) seed.artists = artists;
  if (queries) seed.queries = queries;
  if (typeof v.text === 'string' && v.text.trim()) seed.text = v.text.trim().slice(0, 200);
  return seed;
}

function cleanMore(v: unknown): WaveMoreRequest {
  if (!isObject(v)) throw new UserError('Неверный параметр: волна');
  return { seed: cleanSeed(v.seed), recent: cleanTracks(v.recent) ?? [], round: typeof v.round === 'number' && Number.isFinite(v.round) ? v.round : 0 };
}

/** Ошибка источника — человеческий текст как есть, код — вид ошибки (offline, disabled…). */
function asUserError<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    throw err instanceof SourceError ? new UserError(err.message, err.kind) : err;
  });
}

export function registerWaveIpc(): void {
  handle(IPC.wave.start, async (seed: unknown): Promise<Track[]> => asUserError(wave.start(cleanSeed(seed), await getSettings())));
  handle(IPC.wave.more, async (req: unknown): Promise<Track[]> => asUserError(wave.more(cleanMore(req), await getSettings())));
}
