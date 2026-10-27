import { describe, expect, it } from 'vitest';
import { blockArtist, blockTrack, emptyBlacklist, unblockArtist, unblockTrack } from '../../../shared/blacklist';
import { isBlocked } from '../../../shared/blacklist';
import type { Track } from '../../../shared/types';
import { blockedBy } from './blockedRow';

const t = (id: string, artist: string, title = `Песня ${id}`): Track => ({ id, source: 'youtube', sourceId: id, title, artist, downloadable: true });

describe('blockedBy — что вернуть, чтобы строка перестала быть скрытой', () => {
  it('не скрыт — null', () => {
    expect(blockedBy(t('youtube:1', 'A'), emptyBlacklist())).toBeNull();
  });

  it('скрыта та же песня из другого источника — возвращается запись с её id; после возврата трек не скрыт', () => {
    const catalog = { ...t('catalog:9', 'Плохой'), source: 'catalog' as const, title: 'Песня' };
    const bl = blockTrack(emptyBlacklist(), catalog, 1);
    const yt = t('youtube:1', 'Плохой', 'Песня (Official Audio)');
    const by = blockedBy(yt, bl);
    expect(by).toEqual({ reason: 'track', trackIds: ['catalog:9'], artistKeys: [], label: 'в чёрном списке' });
    expect(isBlocked(yt, unblockTrack(bl, 'catalog:9'))).toBe(false);
  });

  it('скрыт исполнитель на фите в названии — возвращается его ключ', () => {
    const bl = blockArtist(emptyBlacklist(), { name: 'Плохой' }, 1);
    const track = t('youtube:2', 'Другой', 'Песня (feat. Плохой)');
    const by = blockedBy(track, bl);
    expect(by).toMatchObject({ reason: 'artist', trackIds: [], artistKeys: ['плохой'], label: 'исполнитель в чёрном списке' });
    expect(isBlocked(track, unblockArtist(bl, 'плохой'))).toBe(false);
  });
});
