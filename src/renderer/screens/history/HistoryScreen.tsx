import { History } from 'lucide-react';
import { useMemo } from 'react';
import { formatTrackCount, timeAgo } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { PlayButtons } from '../../components/PlayButtons/PlayButtons';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { useNow } from '../../components/useNow';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import styles from './HistoryScreen.module.css';

/** Заголовок экрана и очереди, которую он включает. */
const HISTORY_TITLE = 'История';

/** История: последние 100 прослушанных треков, новые сверху, у каждого — «4 мин назад». */
export function HistoryScreen() {
  const history = useLibrary((s) => s.lib.history);
  const known = useLibrary((s) => s.lib.tracks);
  const now = useNow();

  const entries = useMemo(() => history.filter((h) => known[h.trackId]), [history, known]);
  const tracks = useMemo<Track[]>(() => entries.map((h) => known[h.trackId]), [entries, known]);
  const playedAt = useMemo(() => new Map(entries.map((h) => [h.trackId, h.playedAt])), [entries]);
  const count = tracks.length;

  return (
    <>
      <ScreenHeader
        eyebrow={count > 0 ? `Библиотека · ${formatTrackCount(count)}` : 'Библиотека'}
        title={HISTORY_TITLE}
        aside={
          count > 0 && (
            <PlayButtons tracks={tracks} shuffle={false} title={HISTORY_TITLE} />
          )
        }
      />
      {count === 0 ? (
        <EmptyState icon={History} title="История пока пуста" text="Здесь появятся треки, которые ты слушал." />
      ) : (
        <TrackTable
          tracks={tracks}
          onPlay={(index) => usePlayer.getState().playList(tracks, index, HISTORY_TITLE)}
          rowActions={(track) => (
            <span className={styles.ago}>{timeAgo(playedAt.get(track.id) ?? now, now)}</span>
          )}
        />
      )}
    </>
  );
}
