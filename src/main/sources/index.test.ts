import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/settings';
import type { Track } from '../../shared/types';
import { createStreamPreparer, querySource, resolveStream, setDownloadedLookup, toSourceResult } from './index';
import { SourceError, type SourceContext } from './types';

const track: Track = { id: 'archive:a/b.mp3', source: 'archive', sourceId: 'a/b.mp3', title: 'B', artist: 'A', downloadable: true };
const ctx = (patch: Partial<SourceContext['settings']> = {}): SourceContext => ({
  settings: { ...defaultSettings('C:\\Music\\Aura'), ...patch },
  userDataDir: 'C:\\data',
});

function fetchFailed(code: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = Object.assign(new Error(`getaddrinfo ${code} archive.org`), { code });
  return err;
}

describe('toSourceResult', () => {
  it('треки источника — результат без ошибки', async () => {
    expect(await toSourceResult('archive', async () => [track])).toEqual({ source: 'archive', tracks: [track] });
  });

  it('нет сети — «Нет соединения» у этого источника, без исключения', async () => {
    const result = await toSourceResult('archive', async () => {
      throw fetchFailed('ENOTFOUND');
    });
    expect(result).toEqual({ source: 'archive', tracks: [], error: { kind: 'offline', message: 'Нет соединения' } });
  });

  it('ошибка источника сохраняет свой вид; непонятная — «unknown» с человеческим текстом', async () => {
    const busy = await toSourceResult('soundcloud', async () => {
      throw new SourceError('unavailable', 'SoundCloud не отвечает — попробуй ещё раз');
    });
    expect(busy.error).toEqual({ kind: 'unavailable', message: 'SoundCloud не отвечает — попробуй ещё раз' });

    const weird = await toSourceResult('archive', async () => {
      throw new Error('Cannot read properties of undefined (reading x)');
    });
    expect(weird.error?.kind).toBe('unknown');
    expect(weird.error?.message).not.toContain('Cannot read');
  });
});

describe('querySource', () => {
  it('выключенный YouTube не ищется', async () => {
    const result = await querySource('youtube', 'search', 'x', ctx({ youtubeEnabled: false }));
    expect(result).toMatchObject({ source: 'youtube', tracks: [], error: { kind: 'disabled' } });
  });

  it('выключенный SoundCloud не ищется', async () => {
    const result = await querySource('soundcloud', 'search', 'x', ctx({ soundcloudEnabled: false }));
    expect(result).toMatchObject({ source: 'soundcloud', tracks: [], error: { kind: 'disabled', message: 'SoundCloud выключен в настройках' } });
  });

  it('пока не подключённые источники отдают пустой результат без ошибки', async () => {
    expect(await querySource('local', 'search', 'x', ctx())).toEqual({ source: 'local', tracks: [] });
    expect(await querySource('youtube', 'byTag', 'jazz', ctx())).toEqual({ source: 'youtube', tracks: [] });
  });
});

describe('resolveStream: скачанная копия', () => {
  const file = 'D:/Музыка/Aura/A — B.mp3';

  it('есть скачанный файл — играет он через aura-media, а не поток источника', async () => {
    setDownloadedLookup(async (id) => (id === track.id ? file : null));
    expect(await resolveStream(track, ctx())).toBe(`aura-media://file/${encodeURIComponent(file)}`);
  });

  it('нет скачанной копии — обычный поток', async () => {
    setDownloadedLookup(async () => null);
    expect(await resolveStream(track, ctx())).toBe('https://archive.org/download/a/b.mp3');
  });

  it('сбой поиска копии не мешает потоку', async () => {
    setDownloadedLookup(async () => {
      throw new Error('диск недоступен');
    });
    expect(await resolveStream(track, ctx())).toBe('https://archive.org/download/a/b.mp3');
  });
});

describe('createStreamPreparer — подготовка звука заранее', () => {
  const t = (id: string): Track => ({ id: `youtube:${id}`, source: 'youtube', sourceId: id, title: id, artist: 'A', downloadable: true });

  /** Поддельный резолвер: запоминает запуски («процессы yt-dlp»), каждый ждёт ответа теста или отмены. */
  function fakeResolver() {
    const runs: { id: string; fresh: boolean; signal?: AbortSignal; resolve(url: string): void; reject(e: unknown): void }[] = [];
    const resolve = (track: Track, opts: { fresh?: boolean; signal?: AbortSignal }) =>
      new Promise<string>((res, rej) => {
        const run = { id: track.sourceId, fresh: !!opts.fresh, signal: opts.signal, resolve: res, reject: rej };
        runs.push(run);
        opts.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
      });
    /** «Висящие» запуски: начаты и не отменены, ещё без ответа. */
    const alive = () => runs.filter((r) => !r.signal?.aborted && !(r as { done?: boolean }).done);
    return { runs, resolve, alive };
  }

  it('не больше 2 подготовок одновременно и не больше 4 треков на владельца; подготовленный трек — без второго запуска', async () => {
    const f = fakeResolver();
    const prep = createStreamPreparer(f.resolve);
    prep.prepare('player', ['a', 'b', 'c', 'd', 'e', 'f'].map(t));
    expect(f.runs.map((r) => r.id)).toEqual(['a', 'b']);
    f.runs[0].resolve('url-a');
    await new Promise((r) => setTimeout(r, 0));
    expect(f.runs.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    // Трек, который уже готовится, — к той же работе.
    const b = prep.resolve(t('b'));
    f.runs[1].resolve('url-b');
    await expect(b).resolves.toBe('url-b');
    expect(f.runs.filter((r) => r.id === 'b')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(f.runs.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']); // e, f — дальше 4 вперёд, не готовятся
  });

  it('быстрое листание 10 треков: устаревшие подготовки отменяются (yt-dlp убивается), висит не больше нескольких', async () => {
    const f = fakeResolver();
    const prep = createStreamPreparer(f.resolve);
    const queue = Array.from({ length: 14 }, (_, i) => t(`t${i}`));
    for (let i = 0; i < 10; i++) {
      prep.prepare('player', queue.slice(i, i + 4));
      void prep.resolve(queue[i]).catch(() => undefined);
    }
    const alive = f.runs.filter((r) => !r.signal?.aborted).map((r) => r.id);
    expect(alive.length).toBeLessThanOrEqual(3);
    expect(alive).toContain('t9');
    expect(f.runs.filter((r) => r.signal?.aborted).length).toBeGreaterThan(0);
  });

  it('трек нужен другому владельцу (волна проверяет звук) — смена очереди плеера его не отменяет', async () => {
    const f = fakeResolver();
    const prep = createStreamPreparer(f.resolve);
    prep.prepare('wave', [t('w')]);
    const checking = prep.resolve(t('w'));
    prep.prepare('player', [t('x')]);
    expect(f.runs.find((r) => r.id === 'w')?.signal?.aborted).toBe(false);
    f.runs.find((r) => r.id === 'w')!.resolve('url-w');
    await expect(checking).resolves.toBe('url-w');
  });

  it('fresh (повтор плеера) — новый запуск, прежний отменяется', async () => {
    const f = fakeResolver();
    const prep = createStreamPreparer(f.resolve);
    prep.prepare('player', [t('a')]);
    const again = prep.resolve(t('a'), { fresh: true });
    expect(f.runs).toHaveLength(2);
    expect(f.runs[0].signal?.aborted).toBe(true);
    expect(f.runs[1].fresh).toBe(true);
    f.runs[1].resolve('url-a2');
    await expect(again).resolves.toBe('url-a2');
  });

  it('подготовка волны — с проверкой ссылки (verify), подготовка плеера — без', async () => {
    const f = fakeResolver();
    const opts: { id: string; verify?: boolean }[] = [];
    const prep = createStreamPreparer((track, o) => {
      opts.push({ id: track.sourceId, verify: o.verify });
      return f.resolve(track, o);
    });
    prep.prepare('wave', [t('w')], { verify: true });
    prep.prepare('player', [t('p')]);
    expect(opts).toEqual([{ id: 'w', verify: true }, { id: 'p', verify: undefined }]);
  });

  it('прямой запрос не отменяется подготовкой другого владельца, пока его не взял ни один набор', async () => {
    const f = fakeResolver();
    const prep = createStreamPreparer(f.resolve);
    // Плеер: resolve нового текущего ушёл раньше своего prepare; в это время приходит prepare волны.
    const a = prep.resolve(t('a'));
    prep.prepare('wave', []);
    expect(f.runs[0].signal?.aborted).toBe(false);
    // Зеркально: проверка волны (resolve) до её prepare, а плеер пересобрал свой набор.
    const w = prep.resolve(t('w'), { verify: true });
    prep.prepare('player', [t('a')]);
    expect(f.runs[1].signal?.aborted).toBe(false);
    f.runs[0].resolve('url-a');
    f.runs[1].resolve('url-w');
    await expect(a).resolves.toBe('url-a');
    await expect(w).resolves.toBe('url-w');
  });

  it('прямой запрос, взятый владельцем, отменяется, когда тот от него отказался (пролистали)', () => {
    const f = fakeResolver();
    const prep = createStreamPreparer(f.resolve);
    void prep.resolve(t('a')).catch(() => undefined);
    prep.prepare('player', [t('a')]);
    prep.prepare('player', [t('b')]);
    expect(f.runs[0].signal?.aborted).toBe(true);
  });
});
