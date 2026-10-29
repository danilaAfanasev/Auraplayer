import { describe, expect, it } from 'vitest';
import type { Track } from './types';
import {
  artistKeys,
  banTrack,
  canFollow,
  emptyWaveMemory,
  isBanned,
  pickWaveTracks,
  rememberTracks,
  scriptOf,
  songKey,
  syncWaveTail,
  WAVE_MIN_ARTIST_GAP,
  type WaveMemory,
} from './wave';

let n = 0;
const t = (artist: string, title: string, source: Track['source'] = 'youtube'): Track => {
  n++;
  return { id: `${source}:id${n}`, source, sourceId: `id${n}`, title, artist, downloadable: true };
};

/** Все исполнители трека с фитами — как их считает правило окна (разбор вручную в тестах ниже не нужен). */
const keysOf = (x: Track) => artistKeys(x.artist, x.title);

/** Первая пара позиций, где один исполнитель встречается ближе `window` треков; нет — null. */
function repeatWithin(list: readonly Track[], window: number): [number, number] | null {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < Math.min(list.length, i + window); j++) {
      if (keysOf(list[i]).some((k) => keysOf(list[j]).includes(k))) return [i, j];
    }
  }
  return null;
}

/** Отобрать порциями по `batch`, пока отборщик что-то даёт и не набралось `total`. */
function pickMany(candidates: readonly Track[], memory: WaveMemory, total: number, batch: number, opts = {}) {
  const out: Track[] = [];
  let mem = memory;
  while (out.length < total) {
    const r = pickWaveTracks(candidates, mem, Math.min(batch, total - out.length), opts);
    if (r.picked.length === 0) break;
    out.push(...r.picked);
    mem = syncWaveTail(r.memory, [...out]);
  }
  return { out, memory: mem };
}

describe('artistKeys / songKey', () => {
  it('соисполнители делятся по запятой, &, feat., x', () => {
    expect(artistKeys('VILLIAN & madk1d')).toEqual(['villian', 'madk1d']);
    expect(artistKeys('shadowraze, LXNER, quiizzzmeow')).toEqual(['shadowraze', 'lxner', 'quiizzzmeow']);
    expect(artistKeys('Aarne feat. Toxi$')).toEqual(['aarne', 'toxi']);
    expect(artistKeys('OG Buda x MAYOT')).toEqual(['og buda', 'mayot']);
    // «x» внутри имени — не разделитель
    expect(artistKeys('xxxmanera')).toEqual(['xxxmanera']);
  });

  it('одна песня из разных источников — один ключ: пометки в скобках и регистр не важны', () => {
    const fromYoutube = t('shadowraze', 'astral step (официальная премьера трека)');
    const fromCatalog = t('Shadowraze', 'Astral Step', 'catalog');
    expect(songKey(fromYoutube)).toBe(songKey(fromCatalog));
    expect(songKey(t('madk1d', 'цена'))).not.toBe(songKey(t('madk1d', 'засосы')));
  });
});

describe('scriptOf', () => {
  it('кириллица в исполнителе или названии — кириллица; иначе латиница или другая письменность', () => {
    expect(scriptOf(t('Платина', 'Иней!'))).toBe('cyrillic');
    expect(scriptOf(t('Платина', 'LUV'))).toBe('cyrillic');
    expect(scriptOf(t('FORTUNA 812', 'Париж'))).toBe('cyrillic');
    expect(scriptOf(t('Bladee', 'Obedient'))).toBe('latin');
    expect(scriptOf(t('Lil Morty feat. LIL KRYSTALLL', 'Patek'))).toBe('latin');
    expect(scriptOf(t('米津玄師', '感電'))).toBe('other');
  });
});

describe('pickWaveTracks: без дублей', () => {
  it('без дублей по id и по «исполнитель — название», в том числе с уже сыгранным в волне', () => {
    const a = t('madk1d', 'цена');
    const aAgain = { ...a };
    const aOtherSource = t('MADK1D', 'Цена (Official Audio)', 'catalog');
    const b = t('VILLIAN', 'Шприц');
    const played = t('FORTUNA 812', 'ParisLove');
    const playedCopy = t('FORTUNA 812', 'ParisLove', 'catalog');

    const first = pickWaveTracks([played], emptyWaveMemory());
    const { picked } = pickWaveTracks([a, aAgain, aOtherSource, b, playedCopy], first.memory);
    expect(picked.map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it('limit ограничивает порцию; не взятые треки могут прийти позже', () => {
    const list = [t('A', '1'), t('B', '2'), t('C', '3')];
    const first = pickWaveTracks(list, emptyWaveMemory(), 2);
    expect(first.picked).toHaveLength(2);
    const second = pickWaveTracks(list, first.memory);
    expect(second.picked.map((x) => x.title)).toEqual(['3']);
  });
});

describe('pickWaveTracks: 10 подряд — 10 разных исполнителей', () => {
  /** Как на скриншоте: Платина почти в каждом кандидате, в том числе на фитах; остальные — по треку. */
  function strongArtistCandidates(): Track[] {
    const platina = [
      t('Платина', 'Групи'),
      t('Платина feat. 104', 'Все цветы вокруг меня'),
      t('Платина', 'Санта Клаус'),
      t('Платина feat. OG Buda, MAYOT', 'Abu Dhabi Ba6y'),
      t('Платина', 'Сердце для шалав'),
      t('Платина', 'Иней!'),
      t('Платина', 'Бассок'),
      t('Платина', 'Хенни'),
    ];
    const others = Array.from({ length: 40 }, (_, i) => t(`Артист ${i}`, `Песня ${i}`));
    // Фит в названии тоже считается: Lil Morty занимает место в окне.
    others.splice(3, 0, t('LIL KRYSTALLL', 'Патек (feat. Lil Morty)'), t('Lil Morty', 'Сам по себе'));
    // Платина идёт в начале списка кандидатов подряд — как в радио, где он самый сильный.
    return [...platina, ...others];
  }

  it('30 треков на кандидатах с одним сильным исполнителем и фитами — в любом окне 10 нет повторов', () => {
    const { out } = pickMany(strongArtistCandidates(), emptyWaveMemory(), 30, 15);
    expect(out).toHaveLength(30);
    expect(repeatWithin(out, 10)).toBeNull();
    // Платина не пропал совсем: он играет, но не чаще раза в 10 треков.
    expect(out.filter((x) => keysOf(x).includes('платина')).length).toBe(3);
  });

  it('окно держится между порциями и учитывает уже сыгранное (хвост очереди)', () => {
    const played = [t('Платина', 'Был в очереди'), ...Array.from({ length: 5 }, (_, i) => t(`Сыгранный ${i}`, 'x'))];
    const memory = syncWaveTail(rememberTracks(emptyWaveMemory(), played), played);
    const { picked } = pickWaveTracks([t('Платина', 'Рано'), t('Новый', 'Песня'), t('Ещё', 'Песня')], memory);
    // До Платины в очереди 5 треков — ещё 4 нужно, кандидатов на них нет: Платина не берётся.
    expect(picked.map((x) => x.artist)).toEqual(['Новый', 'Ещё']);
  });

  it('мало кандидатов: строгое окно отдаёт сколько может, ослабленное (5) — играет дальше, но подряд и ближе 5 — никогда', () => {
    const few = Array.from({ length: 6 }, (_, a) => Array.from({ length: 10 }, (_, i) => t(`Узкий ${a}`, `Трек ${i}`))).flat();
    const strict = pickMany(few, emptyWaveMemory(), 30, 15);
    expect(strict.out.length).toBeLessThan(10);
    const relaxed = pickMany(few, strict.memory, 30, 15, { gap: WAVE_MIN_ARTIST_GAP });
    const all = [...strict.out, ...relaxed.out];
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(repeatWithin(all, WAVE_MIN_ARTIST_GAP)).toBeNull();
  });
});

describe('pickWaveTracks: лайкнутые — не больше 1 на 10', () => {
  it('вкус из лайков: половина кандидатов — песни из «Мне нравится», в 30 треках их ≤ 3 и в любом окне 10 — не больше одной', () => {
    const candidates: Track[] = [];
    for (let i = 0; i < 40; i++) candidates.push(t(`Любимый ${i}`, 'Лайк'), t(`Новый ${i}`, 'Не лайк'));
    const liked = new Set(candidates.filter((x) => x.title === 'Лайк').map(songKey));
    const { out } = pickMany(candidates, emptyWaveMemory(), 30, 15, { liked });
    expect(out).toHaveLength(30);
    const flags = out.map((x) => liked.has(songKey(x)));
    expect(flags.filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(flags.filter(Boolean).length).toBeGreaterThan(0); // редко, но не никогда
    for (let i = 0; i + 10 <= flags.length; i++) expect(flags.slice(i, i + 10).filter(Boolean).length).toBeLessThanOrEqual(1);
  });
});

describe('pickWaveTracks: другая письменность', () => {
  it('волна по русскому треку, зарубежные кандидаты в конце списка — в 30 треках их хотя бы 20 %', () => {
    const lead = t('Платина', 'Иней!');
    const ru = Array.from({ length: 50 }, (_, i) => t(`Русский ${i}`, `Песня ${i}`));
    const en = Array.from({ length: 8 }, (_, i) => t(`Foreign ${i}`, `Song ${i}`));
    const memory = syncWaveTail(rememberTracks(emptyWaveMemory(), [lead]), [lead]);
    const { out } = pickMany([...ru, ...en], memory, 29, 15);
    const wave = [lead, ...out];
    expect(wave).toHaveLength(30);
    expect(wave.filter((x) => scriptOf(x) !== 'cyrillic').length).toBeGreaterThanOrEqual(6);
  });

  it('другой письменности у источника нет — волна идёт как есть', () => {
    const ru = Array.from({ length: 20 }, (_, i) => t(`Русский ${i}`, `Песня ${i}`));
    expect(pickWaveTracks(ru, emptyWaveMemory(), 15).picked).toHaveLength(15);
  });
});

describe('canFollow', () => {
  it('трек можно поставить после этих треков: исполнитель (и на фите) не ближе окна, лайк — не второй в окне', () => {
    const before = [t('Платина', 'Групи'), t('A', '1'), t('B', '2')];
    expect(canFollow(t('Другой feat. Платина', 'x'), before)).toBe(false);
    expect(canFollow(t('C', 'x'), before)).toBe(true);
    const liked = new Set([songKey(before[1]), 'c — лайк']);
    expect(canFollow(t('C', 'Лайк'), before, { liked })).toBe(false);
    expect(canFollow(t('C', 'Лайк'), before, { liked: new Set(['c — лайк']) })).toBe(true);
  });
});

describe('«Не нравится»', () => {
  it('исключает этот трек и всех его исполнителей из волны', () => {
    const disliked = t('VILLIAN & madk1d', 'ДИНАСТИЯ');
    const memory = banTrack(emptyWaveMemory(), disliked);
    expect(isBanned(disliked, memory)).toBe(true);
    expect(isBanned(t('madk1d', 'цена'), memory)).toBe(true);
    expect(isBanned(t('тёмный принц, VILLIAN', 'ПАПА'), memory)).toBe(true);
    expect(isBanned(t('FORTUNA 812', 'ParisLove'), memory)).toBe(false);

    const { picked } = pickWaveTracks([t('madk1d', 'засосы'), t('CUPSIZE', 'Юра, Юра'), { ...disliked }], memory);
    expect(picked.map((x) => x.title)).toEqual(['Юра, Юра']);
  });

  it('фит в названии — тоже исполнитель: «Не нравится» на таком треке убирает и треки исполнителя фита', () => {
    const memory = banTrack(emptyWaveMemory(), t('Other', 'Song (feat. Bad)'));
    expect(isBanned(t('Bad', 'Своя песня'), memory)).toBe(true);
    // и наоборот: исполнитель из чёрного списка волны на фите в названии чужого трека
    const byArtist = banTrack(emptyWaveMemory(), t('Bad', 'Своя песня'));
    expect(isBanned(t('Other', 'Song (feat. Bad)'), byArtist)).toBe(true);
    expect(isBanned(t('Other', 'Song ft. Bad'), byArtist)).toBe(true);

    const { picked } = pickWaveTracks([t('Clean', 'Track (feat. Bad)'), t('Clean', 'Другой')], byArtist);
    expect(picked.map((x) => x.title)).toEqual(['Другой']);
  });
});
