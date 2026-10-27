// Тексты песен (G63): IPC над сервисом `src/main/lyrics.ts`. Запросы к базе текстов идут только отсюда.
import { app } from 'electron';
import { IPC } from '../../shared/ipc';
import type { Lyrics } from '../../shared/lyrics';
import { SOURCE_IDS, type SourceId, type Track } from '../../shared/types';
import { createLyricsFetch, createLyricsService, LYRICS_FILE, lyricsUserAgent, type LyricsService } from '../lyrics';
import { SourceError } from '../sources/types';
import { readJson, writeJson } from '../store';
import { handle, UserError } from './handle';

/** Заранее — текущий и три следующих; с запасом на лишнее, но не больше. */
const MAX_PREFETCH = 8;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Трек из рендерера: нужные для поиска поля проверены, остальное отброшено. */
function cleanTrack(v: unknown): Track | null {
  if (
    !isObject(v) ||
    typeof v.id !== 'string' ||
    typeof v.sourceId !== 'string' ||
    typeof v.title !== 'string' ||
    typeof v.artist !== 'string' ||
    !SOURCE_IDS.includes(v.source as SourceId)
  ) {
    return null;
  }
  const track: Track = { id: v.id, source: v.source as SourceId, sourceId: v.sourceId, title: v.title, artist: v.artist, downloadable: false };
  if (typeof v.album === 'string') track.album = v.album;
  if (typeof v.durationSec === 'number' && Number.isFinite(v.durationSec)) track.durationSec = v.durationSec;
  return track;
}

let service: LyricsService | null = null;

function getService(): LyricsService {
  service ??= createLyricsService({
    fetch: createLyricsFetch(lyricsUserAgent(app.getVersion())),
    readCache: () => readJson<unknown>(LYRICS_FILE, {}),
    writeCache: (cache) => writeJson(LYRICS_FILE, cache),
  });
  return service;
}

export function registerLyricsIpc(): void {
  handle(IPC.lyrics.get, async (track: unknown): Promise<Lyrics> => {
    const clean = cleanTrack(track);
    if (!clean) throw new UserError('Неверный параметр: трек');
    try {
      return await getService().get(clean);
    } catch (err) {
      throw err instanceof SourceError ? new UserError(err.message, err.kind) : err;
    }
  });
  handle(IPC.lyrics.prefetch, (tracks: unknown): void => {
    if (!Array.isArray(tracks)) throw new UserError('Неверный параметр: треки');
    const clean = tracks
      .slice(0, MAX_PREFETCH)
      .map(cleanTrack)
      .filter((t): t is Track => t !== null);
    getService().prefetch(clean);
  });
}
