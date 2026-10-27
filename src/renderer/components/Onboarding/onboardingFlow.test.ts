import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockArtist, emptyLibrary, pushHistory } from '../../../shared/library';
import { defaultSettings, normalizeSettings } from '../../../shared/settings';
import type { PopularArtist, Track } from '../../../shared/types';
import { myWaveSeed } from '../../stores/tasteWave';
import { useLibrary } from '../../stores/useLibrary';
import { useSettings } from '../../stores/useSettings';
import { finishOnboarding, needsOnboarding, rankPopular, skipOnboarding } from './onboardingFlow';

vi.stubGlobal('window', { aura: { library: { save: vi.fn() }, settings: { save: vi.fn() } } });

const DIR = 'C:/Music/Aura';
const track: Track = { id: 'youtube:1', source: 'youtube', sourceId: '1', title: 'Песня', artist: 'Someone', downloadable: true };

describe('кому показывать «Что ты слушаешь?»', () => {
  it('новый пользователь (нет settings.json, пустая библиотека) — да', () => {
    expect(needsOnboarding(normalizeSettings(null, DIR), emptyLibrary())).toBe(true);
  });

  it('уже прошёл или пропустил — нет', () => {
    expect(needsOnboarding({ ...defaultSettings(DIR), onboarded: true }, emptyLibrary())).toBe(false);
  });

  it('старый пользователь (настройки без поля onboarded) или с историей/подписками/лайками — нет', () => {
    expect(needsOnboarding(normalizeSettings({ version: 1, volume: 0.5 }, DIR), emptyLibrary())).toBe(false);
    const fresh = defaultSettings(DIR);
    expect(needsOnboarding(fresh, pushHistory(emptyLibrary(), track, 1))).toBe(false);
    expect(needsOnboarding(fresh, { ...emptyLibrary(), likes: ['youtube:1'], tracks: { 'youtube:1': track } })).toBe(false);
    expect(needsOnboarding(fresh, { ...emptyLibrary(), followedArtists: [{ id: '1', name: 'A', followedAt: 1 }] })).toBe(false);
  });

  it('настройки не прочитались (заглушка без папки скачивания) — не показывать', () => {
    expect(needsOnboarding(defaultSettings(''), emptyLibrary())).toBe(false);
  });
});

describe('популярные артисты с учётом выбранных жанров', () => {
  const list: PopularArtist[] = [
    { id: '1', name: 'Pop One', tags: ['pop'] },
    { id: '2', name: 'Rap One', tags: ['hiphop'] },
    { id: '3', name: 'No Genre' },
    { id: '4', name: 'Rap Two', tags: ['hiphop', 'pop'] },
    { id: '5', name: 'Hidden', tags: ['hiphop'] },
  ];
  const bl = blockArtist(emptyLibrary(), { name: 'Hidden' }, 1).blacklist;

  it('жанры не выбраны — порядок чарта, без скрытых', () => {
    expect(rankPopular(list, [], bl).map((a) => a.id)).toEqual(['1', '2', '3', '4']);
  });

  it('выбран жанр — его артисты первыми (в порядке чарта), остальные следом', () => {
    expect(rankPopular(list, ['hiphop'], bl).map((a) => a.id)).toEqual(['2', '4', '1', '3']);
  });
});

describe('«Готово» и «Пропустить»', () => {
  beforeEach(() => {
    useLibrary.setState({ lib: emptyLibrary(), loaded: true });
    useSettings.setState({ settings: defaultSettings(DIR), loaded: true });
  });

  it('«Готово» с двумя артистами и жанром: подписки, стартовый вкус, жанры, больше не показывать; «Моя волна» — от них', () => {
    finishOnboarding({
      artists: [
        { id: '10', name: 'First Pick' },
        { id: '20', name: 'Second Pick' },
      ],
      genres: ['rock'],
    });
    const { lib } = useLibrary.getState();
    expect(lib.followedArtists.map((a) => a.id).sort()).toEqual(['10', '20']);
    expect(lib.taste.events.filter((e) => e.kind === 'onboard').map((e) => e.artist).sort()).toEqual(['First Pick', 'Second Pick']);
    expect(lib.taste.genres).toEqual(['rock']);
    expect(useSettings.getState().settings.onboarded).toBe(true);
    expect(needsOnboarding(useSettings.getState().settings, lib)).toBe(false);
    expect([...(myWaveSeed(lib, Date.now()).artists ?? [])].sort()).toEqual(['First Pick', 'Second Pick']);
  });

  it('«Пропустить» — только больше не показывать, библиотека не меняется', () => {
    const before = useLibrary.getState().lib;
    skipOnboarding();
    expect(useLibrary.getState().lib).toBe(before);
    expect(useSettings.getState().settings.onboarded).toBe(true);
  });
});
