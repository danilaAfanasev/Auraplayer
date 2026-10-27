import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/settings';
import type { Track } from '../../shared/types';
import { YtDlpError } from '../ytdlp';
import searchMadk1d from './__fixtures__/youtube-search-madk1d.json';
import searchSample from './__fixtures__/youtube-search.json';
import videoSample from './__fixtures__/youtube-video.json';
import { SourceError, type SourceContext } from './types';
import { classifyYtDlpError, createYoutubeAdapter, parseYtSearch, parseYtStream, searchYtStream, type RunYtDlp } from './youtube';

const ctx: SourceContext = { settings: defaultSettings('C:\\Music\\Aura'), userDataDir: 'C:\\data' };
/** Часы тестов потока: за час до срока ссылки образца (`expire`) — тест не зависит от системных часов. */
const BEFORE_LINK_EXPIRES = Number(new URL(videoSample.url).searchParams.get('expire')) * 1000 - 3_600_000;

const ytTrack = (videoId: string): Track => ({
  id: `youtube:${videoId}`,
  source: 'youtube',
  sourceId: videoId,
  title: 'Группа крови',
  artist: 'Группа КИНО',
  downloadable: true,
});

describe('parseYtSearch', () => {
  it('разбирает плоский JSON ytsearch: название, канал, длительность, обложка, страница', () => {
    const tracks = parseYtSearch(searchSample);
    expect(tracks[0]).toEqual<Track>({
      id: 'youtube:xtxjm7ciwmc',
      source: 'youtube',
      sourceId: 'xtxjm7ciwmc',
      title: 'Группа крови',
      artist: 'Группа КИНО',
      durationSec: 285,
      coverUrl:
        'https://i.ytimg.com/vi/xtxjm7ciwmc/hq720.jpg?sqp=-oaymwEcCNAFEJQDSFXyq4qpAw4IARUAAIhCGAFwAcABBg==&rs=AOn4CLAu3nUtGfiV6XsJEq2bFXtqxSmuBg',
      downloadable: true,
      pageUrl: 'https://www.youtube.com/watch?v=xtxjm7ciwmc',
    });
  });

  it('«Исполнитель - Название» в заголовке видео делится на исполнителя и название', () => {
    const t = parseYtSearch(searchSample).find((x) => x.sourceId === 'xKpzH5bxYsk');
    expect(t?.artist).toBe('Виктор Цой');
    expect(t?.title).toBe('Группа Крови');
  });

  it('прямые трансляции пропускаются, остальные — по порядку', () => {
    const ids = parseYtSearch(searchSample).map((t) => t.sourceId);
    expect(ids).toEqual(['xtxjm7ciwmc', 'xKpzH5bxYsk', 'RcQuuvMHbOM', 'K69_m4gtZDk', 'MTJhfySLSCQ']);
  });

  it('обложка без широкой миниатюры — стабильный mqdefault', () => {
    const entry = searchSample.entries[1];
    const squareOnly = [{ url: 'https://i.ytimg.com/vi/xKpzH5bxYsk/hqdefault.jpg', width: 480, height: 360 }];
    const [t] = parseYtSearch({ entries: [{ ...entry, thumbnails: squareOnly }] });
    expect(t.coverUrl).toBe('https://i.ytimg.com/vi/xKpzH5bxYsk/mqdefault.jpg');
    const [noThumbs] = parseYtSearch({ entries: [{ ...entry, thumbnails: undefined }] });
    expect(noThumbs.coverUrl).toBe('https://i.ytimg.com/vi/xKpzH5bxYsk/mqdefault.jpg');
  });

  it('признак официального аудио: канал «- Topic» или «Official Audio» в названии', () => {
    const entry = { id: 'bbbbbbbbbb1', title: 'Song', channel: 'Artist - Topic', duration: 100, ie_key: 'Youtube' };
    const [topic] = parseYtSearch({ entries: [entry] });
    expect(topic.official).toBe(true);
    expect(topic.artist).toBe('Artist');
    const [audio] = parseYtSearch({ entries: [{ ...entry, title: 'Artist - Song (Official Audio)', channel: 'Label' }] });
    expect(audio.official).toBe(true);
    const [plain] = parseYtSearch({ entries: [{ ...entry, channel: 'Label' }] });
    expect(plain.official).toBeUndefined();
  });

  it('мусор на входе — пустой список', () => {
    expect(parseYtSearch(null)).toEqual([]);
    expect(parseYtSearch({ entries: [{ id: '../../x', title: 'x' }, { _type: 'url', ie_key: 'YoutubeTab', id: 'UCabc' }] })).toEqual([]);
  });
});

describe('parseYtStream', () => {
  it('прямой https-URL выбранного аудиоформата', () => {
    expect(parseYtStream(videoSample)).toBe('https://rr2---sn-xguxaxjvh-8v1e.googlevideo.com/videoplayback?expire=1792880244&id=fixture');
  });

  it('без выбранного — лучший аудиоформат по https (не HLS)', () => {
    const formats = videoSample.formats.map((f) => ({ ...f, url: `${f.url}#${f.format_id}` }));
    const url = parseYtStream({ ...videoSample, url: undefined, formats });
    expect(url.endsWith('#251')).toBe(true);
  });

  it('только HLS/видео — понятная ошибка источника', () => {
    const formats = videoSample.formats.filter((f) => f.protocol !== 'https');
    expect(() => parseYtStream({ ...videoSample, url: undefined, protocol: 'm3u8_native', formats })).toThrow(SourceError);
  });
});

describe('classifyYtDlpError — понятные тексты', () => {
  const cases: [unknown, SourceError['kind'], RegExp][] = [
    [new YtDlpError('timeout', 'x'), 'unavailable', /YouTube не отвечает.*VPN/],
    [new YtDlpError('failed', 'ERROR: [youtube] x: Unable to download API page: <urlopen error [Errno 11001] getaddrinfo failed>'), 'offline', /соединени/i],
    [new YtDlpError('failed', "ERROR: [youtube] x: Sign in to confirm you're not a bot."), 'unavailable', /YouTube/],
    [new YtDlpError('failed', 'ERROR: [youtube] x: Video unavailable'), 'unavailable', /Видео недоступно/],
    [new YtDlpError('failed', 'ERROR: [youtube] aaaaaaaaaaa: This video is unavailable'), 'unavailable', /Видео недоступно/],
    [new YtDlpError('failed', 'ERROR: [youtube] x: Sign in to confirm your age.'), 'unavailable', /возраст/],
    [new YtDlpError('failed', 'ERROR: unable to download video data: HTTP Error 403: Forbidden'), 'unavailable', /Обнови yt-dlp/i],
    [new YtDlpError('failed', 'ERROR: [download] Got error: HTTP Error 503: Service Unavailable. Giving up after 3 retries'), 'unavailable', /временно/],
    [new YtDlpError('install','Не удалось скачать yt-dlp с GitHub — проверь соединение'), 'unavailable', /Не удалось скачать yt-dlp/],
  ];
  it.each(cases)('%s', (err, kind, text) => {
    const e = classifyYtDlpError(err);
    expect(e.kind).toBe(kind);
    expect(e.message).toMatch(text);
  });

  it('отмена пробрасывается как есть', () => {
    const abort = new DOMException('Aborted', 'AbortError');
    expect(() => classifyYtDlpError(abort)).toThrow(abort);
  });
});

describe('адаптер YouTube', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aura-yt-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('поиск: ytsearch20 с плоским JSON', async () => {
    const seen: string[][] = [];
    const run: RunYtDlp = async (args) => {
      seen.push([...args]);
      return { stdout: JSON.stringify(searchSample), stderr: '' };
    };
    const tracks = await createYoutubeAdapter(run).search('кино группа крови', ctx);
    // ролик «Альбом» на 47 минут от обычного канала отсеян
    expect(tracks.map((t) => t.sourceId)).toEqual(['xtxjm7ciwmc', 'xKpzH5bxYsk', 'RcQuuvMHbOM', 'MTJhfySLSCQ']);
    expect(seen[0]).toEqual(expect.arrayContaining(['--flat-playlist', '-J', 'ytsearch20:кино группа крови']));
  });

  it('поиск: ролики на часы и «ТОП 10» отсеяны, клипы остаются', async () => {
    const run: RunYtDlp = async () => ({ stdout: JSON.stringify(searchMadk1d), stderr: '' });
    const tracks = await createYoutubeAdapter(run).search('madk1d', ctx);
    expect(tracks.map((t) => t.sourceId)).toEqual(['J7NFL-eOxiQ', 'N9ZjkSrsZRA', '3KVuiRBk5RI']);
  });

  it('поиск: интервью на 4 минуты и обычный ролик на 11 минут отсеяны, Topic на 11 минут и Remix — нет', async () => {
    const entry = (id: string, title: string, channel: string, duration: number) => ({ id, title, channel, duration, ie_key: 'Youtube' });
    const json = {
      entries: [
        entry('aaaaaaaaaa1', 'Artist - Song (интервью)', 'Канал', 240),
        entry('aaaaaaaaaa2', 'Artist - Long jam', 'Канал', 660),
        entry('aaaaaaaaaa3', 'Long suite', 'Artist - Topic', 660),
        entry('aaaaaaaaaa4', 'Artist - Song (Remix)', 'Канал', 200),
      ],
    };
    const run: RunYtDlp = async () => ({ stdout: JSON.stringify(json), stderr: '' });
    const tracks = await createYoutubeAdapter(run).search('q', ctx);
    expect(tracks.map((t) => t.sourceId)).toEqual(['aaaaaaaaaa3', 'aaaaaaaaaa4']);
    expect(tracks[0].official).toBe(true);
    expect(tracks[1].official).toBeUndefined();
  });

  it('поток: неверный id не доходит до yt-dlp', async () => {
    let calls = 0;
    const run: RunYtDlp = async () => {
      calls++;
      return { stdout: '{}', stderr: '' };
    };
    await expect(createYoutubeAdapter(run).resolveStream(ytTrack('--cookies=x'), ctx)).rejects.toThrow(SourceError);
    expect(calls).toBe(0);
  });

  it('поток: URL из ответа yt-dlp, повтор — из кэша', async () => {
    let calls = 0;
    const run: RunYtDlp = async (args) => {
      calls++;
      expect(args.at(-1)).toBe('https://www.youtube.com/watch?v=mG1aeD7odqk');
      return { stdout: JSON.stringify(videoSample), stderr: '' };
    };
    const yt = createYoutubeAdapter(run, () => BEFORE_LINK_EXPIRES);
    const url = await yt.resolveStream(ytTrack('mG1aeD7odqk'), ctx);
    expect(url).toBe(videoSample.url);
    expect(await yt.resolveStream(ytTrack('mG1aeD7odqk'), ctx)).toBe(url);
    expect(calls).toBe(1);
  });

  it('поток: быстрый клиент YouTube (без задачи JS и без HLS) — один запуск', async () => {
    const seen: string[][] = [];
    const run: RunYtDlp = async (args) => {
      seen.push([...args]);
      return { stdout: JSON.stringify(videoSample), stderr: '' };
    };
    await createYoutubeAdapter(run, () => BEFORE_LINK_EXPIRES).resolveStream(ytTrack('mG1aeD7odqk'), ctx);
    expect(seen).toHaveLength(1);
    const i = seen[0].indexOf('--extractor-args');
    expect(seen[0][i + 1]).toMatch(/^youtube:.*player_client=visionos/);
    expect(seen[0][i + 1]).toMatch(/skip=hls/);
  });

  it('поток: быстрый клиент не дал звука — тот же трек через клиенты по умолчанию', async () => {
    const seen: string[][] = [];
    const run: RunYtDlp = async (args) => {
      seen.push([...args]);
      if (seen.length === 1) throw new YtDlpError('failed', 'ERROR: [youtube] mG1aeD7odqk: Requested format is not available');
      return { stdout: JSON.stringify(videoSample), stderr: '' };
    };
    await expect(createYoutubeAdapter(run, () => BEFORE_LINK_EXPIRES).resolveStream(ytTrack('mG1aeD7odqk'), ctx)).resolves.toBe(videoSample.url);
    expect(seen).toHaveLength(2);
    expect(seen[1].join(' ')).not.toMatch(/player_client=/);
    expect(seen[1].at(-1)).toBe('https://www.youtube.com/watch?v=mG1aeD7odqk');
  });

  it('поток: нет сети — без второго запуска; повтор плеера (fresh) — сразу клиенты по умолчанию', async () => {
    const seen: string[][] = [];
    let offline = true;
    const run: RunYtDlp = async (args) => {
      seen.push([...args]);
      if (offline) throw new YtDlpError('failed', 'ERROR: [Errno 11001] getaddrinfo failed');
      return { stdout: JSON.stringify(videoSample), stderr: '' };
    };
    const yt = createYoutubeAdapter(run, () => BEFORE_LINK_EXPIRES);
    await expect(yt.resolveStream(ytTrack('mG1aeD7odqk'), ctx)).rejects.toMatchObject({ kind: 'offline' });
    expect(seen).toHaveLength(1);
    offline = false;
    await yt.resolveStream(ytTrack('mG1aeD7odqk'), ctx, { fresh: true });
    expect(seen).toHaveLength(2);
    expect(seen[1].join(' ')).not.toMatch(/player_client=/);
  });

  it('поток с проверкой (волна): ссылка быстрого клиента не отдаёт звук (503) — клиенты по умолчанию; не отдаёт и она — ошибка', async () => {
    const seen: string[][] = [];
    const run: RunYtDlp = async (args) => {
      seen.push([...args]);
      const fast = args.join(' ').includes('player_client=visionos');
      return { stdout: JSON.stringify({ ...videoSample, url: fast ? 'https://bad.example/a?expire=1' : videoSample.url }), stderr: '' };
    };
    let good = true;
    const probed: string[] = [];
    const probe = async (url: string) => {
      probed.push(url);
      return good && !url.startsWith('https://bad.example');
    };
    const yt = createYoutubeAdapter(run, () => BEFORE_LINK_EXPIRES, probe);
    await expect(yt.resolveStream(ytTrack('mG1aeD7odqk'), ctx, { verify: true })).resolves.toBe(videoSample.url);
    expect(seen).toHaveLength(2);
    expect(probed).toEqual(['https://bad.example/a?expire=1', videoSample.url]);
    good = false;
    await expect(yt.resolveStream(ytTrack('mG1aeD7odqk'), ctx, { verify: true, fresh: true })).rejects.toBeInstanceOf(SourceError);
    // Без проверки (проигрывание) — ссылка как есть, без лишнего запроса.
    probed.length = 0;
    await yt.resolveStream(ytTrack('mG1aeD7odqk'), ctx);
    expect(probed).toEqual([]);
  });

  it('поток: отмена подготовки доходит до yt-dlp (процесс убивается)', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const run: RunYtDlp = async (_args, signal) => {
      signals.push(signal);
      return { stdout: JSON.stringify(videoSample), stderr: '' };
    };
    const controller = new AbortController();
    await createYoutubeAdapter(run, () => BEFORE_LINK_EXPIRES).resolveStream(ytTrack('mG1aeD7odqk'), ctx, { signal: controller.signal });
    expect(signals[0]).toBe(controller.signal);
  });

  it('скачивание: m4a без перекодирования, прогресс, итоговый путь с расширением', async () => {
    const dest = join(dir, 'Группа КИНО — Группа крови.ab12.part');
    let seen: string[] = [];
    const run: RunYtDlp = async (args, _signal, opts) => {
      seen = [...args];
      opts?.onLine?.('[aura] 1000 4000 NA');
      opts?.onLine?.('[aura] 2000 NA 4000');
      writeFileSync(`${dest}.m4a`, 'audio');
      return { stdout: '', stderr: '' };
    };
    const progress: number[] = [];
    const out = await createYoutubeAdapter(run).download!(ytTrack('xtxjm7ciwmc'), dest, ctx, (p) => progress.push(p), new AbortController().signal);
    expect(out).toBe(`${dest}.m4a`);
    expect(progress).toEqual(expect.arrayContaining([0.25, 0.5]));
    const f = seen[seen.indexOf('-f') + 1];
    expect(f.startsWith('bestaudio[ext=m4a]')).toBe(true);
    expect(seen).not.toContain('-x'); // без извлечения/перекодирования
    expect(seen).not.toContain('--extract-audio');
  });

  it('скачивание: m4a не отдаётся (HTTP 503) — берётся другое аудио как есть, хвосты первой попытки удалены', async () => {
    const dest = join(dir, 'A — B.aa11.part');
    const formats: string[] = [];
    const run: RunYtDlp = async (args) => {
      const f = args[args.indexOf('-f') + 1];
      formats.push(f);
      if (formats.length === 1) {
        writeFileSync(`${dest}.m4a.part`, 'half');
        throw new YtDlpError('failed', 'ERROR: [download] Got error: HTTP Error 503: Service Unavailable. Giving up after 3 retries');
      }
      writeFileSync(`${dest}.webm`, 'audio');
      return { stdout: '', stderr: '' };
    };
    const out = await createYoutubeAdapter(run).download!(ytTrack('xKpzH5bxYsk'), dest, ctx, () => undefined, new AbortController().signal);
    expect(out).toBe(`${dest}.webm`);
    expect(formats).toHaveLength(2);
    expect(formats[0].startsWith('bestaudio[ext=m4a]')).toBe(true);
    expect(formats[1].startsWith('bestaudio[ext=webm]')).toBe(true);
    expect(readdirSync(dir)).toEqual(['A — B.aa11.part.webm']);
  });

  it('скачивание: % в имени экранируется для шаблона yt-dlp', async () => {
    const dest = join(dir, '100% — Хит.cd34.part');
    let output = '';
    const run: RunYtDlp = async (args) => {
      output = args[args.indexOf('-o') + 1];
      writeFileSync(`${dest}.m4a`, 'audio');
      return { stdout: '', stderr: '' };
    };
    await createYoutubeAdapter(run).download!(ytTrack('xtxjm7ciwmc'), dest, ctx, () => undefined, new AbortController().signal);
    expect(output).toBe(`${dest.replace('%', '%%')}.%(ext)s`);
  });

  it('скачивание: ошибка или отмена — частичные файлы удалены', async () => {
    const dest = join(dir, 'A — B.ef56.part');
    writeFileSync(join(dir, 'чужой.mp3'), 'x');
    const run: RunYtDlp = async () => {
      writeFileSync(`${dest}.m4a.part`, 'half');
      throw new DOMException('Aborted', 'AbortError');
    };
    await expect(
      createYoutubeAdapter(run).download!(ytTrack('xtxjm7ciwmc'), dest, ctx, () => undefined, new AbortController().signal),
    ).rejects.toThrow(/Aborted/);
    expect(readdirSync(dir)).toEqual(['чужой.mp3']);
  });
});

describe('searchYtStream — поиск видео и ссылка на звук одним запуском yt-dlp', () => {
  it('один запуск: ytsearch, фильтры кандидатов, первый подходящий — сразу со ссылкой; анонимно', async () => {
    const seen: string[][] = [];
    const run: RunYtDlp = async (args, _signal, opts) => {
      seen.push([...args]);
      opts?.onLine?.('[youtube] Extracting URL');
      opts?.onLine?.(JSON.stringify({ ...videoSample, description: 'Provided to YouTube by X' }));
      // yt-dlp завершается кодом 101 «достигнут --max-downloads» — это не ошибка.
      throw new YtDlpError('failed', 'yt-dlp завершился с ошибкой');
    };
    const hit = await searchYtStream(run, 'Группа КИНО - Группа крови', ['duration>=230 & duration<=250', "channel~='кино'"], {
      now: () => BEFORE_LINK_EXPIRES,
    });
    expect(hit).toMatchObject({ videoId: 'mG1aeD7odqk', url: videoSample.url, channel: 'the bootleg boy 2', durationSec: 3620 });
    expect(seen).toHaveLength(1);
    const args = seen[0];
    expect(args.slice(-2)).toEqual(['--', 'ytsearch5:Группа КИНО - Группа крови']);
    expect(args).toEqual(expect.arrayContaining(['-j', '--max-downloads', '1']));
    expect(args.filter((a) => a === '--match-filter')).toHaveLength(2);
    expect(args).toContain('duration>=230 & duration<=250');
    expect(args.join(' ')).not.toMatch(/cookie|username|password|netrc/i);
  });

  it('ничего не прошло фильтр — null; сбой извлечения кандидата — его id без ссылки; нет сети — ошибка', async () => {
    const none: RunYtDlp = async () => ({ stdout: '', stderr: '' });
    await expect(searchYtStream(none, 'q', [])).resolves.toBeNull();
    const broken: RunYtDlp = async () => {
      throw new YtDlpError('failed', 'ERROR: [youtube] abcdefghijk: Requested format is not available', 'ERROR: [youtube] abcdefghijk: Requested format is not available\n');
    };
    await expect(searchYtStream(broken, 'q', [])).resolves.toMatchObject({ videoId: 'abcdefghijk', url: null });
    const offline: RunYtDlp = async () => {
      throw new YtDlpError('failed', 'ERROR: [Errno 11001] getaddrinfo failed');
    };
    await expect(searchYtStream(offline, 'q', [])).rejects.toMatchObject({ kind: 'offline' });
  });
});
