import { describe, expect, it } from 'vitest';
import type { Track } from './types';
import { artistKeys, banTrack, emptyWaveMemory, isBanned, pickWaveTracks, songKey } from './wave';

let n = 0;
const t = (artist: string, title: string, source: Track['source'] = 'youtube'): Track => {
  n++;
  return { id: `${source}:id${n}`, source, sourceId: `id${n}`, title, artist, downloadable: true };
};

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

describe('pickWaveTracks', () => {
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

  it('один исполнитель не больше 2 раз подряд — третий трек ждёт другого исполнителя', () => {
    const s1 = t('shadowraze', '1000-7');
    const s2 = t('shadowraze', 'showdown');
    const s3 = t('shadowraze, jzxdx', 'skyline ryodan');
    const z = t('zxcursed', 'mana break');
    const { picked } = pickWaveTracks([s1, s2, s3, z], emptyWaveMemory());
    expect(picked.map((x) => x.title)).toEqual(['1000-7', 'showdown', 'mana break', 'skyline ryodan']);
  });

  it('соисполнитель тоже считается: madk1d на фитах не идёт третьим подряд', () => {
    const list = [t('greyrock, tewiq & madk1d', 'распять'), t('madk1d & CUPSIZE', '1 мая'), t('tuborosho & madk1d', 'Ресток'), t('OG Buda', 'Фэм')];
    const { picked } = pickWaveTracks(list, emptyWaveMemory());
    expect(picked.map((x) => x.title)).toEqual(['распять', '1 мая', 'Фэм', 'Ресток']);
  });

  it('правило «не больше 2 подряд» действует и на стыке с прошлой порцией', () => {
    const before = pickWaveTracks([t('shadowraze', 'a'), t('shadowraze', 'b')], emptyWaveMemory());
    const { picked } = pickWaveTracks([t('shadowraze', 'c'), t('АДЛИН', 'Dead Inside')], before.memory);
    expect(picked.map((x) => x.title)).toEqual(['Dead Inside', 'c']);
  });

  it('если разбавить нечем — лишние треки того же исполнителя не берутся', () => {
    const { picked } = pickWaveTracks([t('madk1d', 'a'), t('madk1d', 'b'), t('madk1d', 'c')], emptyWaveMemory());
    expect(picked.map((x) => x.title)).toEqual(['a', 'b']);
  });

  it('limit ограничивает порцию; не взятые треки могут прийти позже', () => {
    const list = [t('A', '1'), t('B', '2'), t('C', '3')];
    const first = pickWaveTracks(list, emptyWaveMemory(), 2);
    expect(first.picked).toHaveLength(2);
    const second = pickWaveTracks(list, first.memory);
    expect(second.picked.map((x) => x.title)).toEqual(['3']);
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
