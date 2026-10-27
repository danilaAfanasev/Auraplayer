import { Heart, Search } from 'lucide-react';
import { useMemo } from 'react';
import { formatTrackCount } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { PlayButtons } from '../../components/PlayButtons/PlayButtons';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';

/** Заголовок экрана и очереди, которую он включает. */
const LIKES_TITLE = 'Мне нравится';

/** «Мне нравится»: лайкнутые треки, новые сверху. */
export function LikesScreen() {
  const navigate = useUi((s) => s.navigate);
  const likes = useLibrary((s) => s.lib.likes);
  const known = useLibrary((s) => s.lib.tracks);
  const tracks = useMemo<Track[]>(() => likes.map((id) => known[id]).filter((t): t is Track => Boolean(t)), [likes, known]);
  const count = tracks.length;

  return (
    <>
      <ScreenHeader
        eyebrow={count > 0 ? `Библиотека · ${formatTrackCount(count)}` : 'Библиотека'}
        title={LIKES_TITLE}
        aside={
          count > 0 && (
            <PlayButtons tracks={tracks} title={LIKES_TITLE} />
          )
        }
      />
      {count === 0 ? (
        <EmptyState
          icon={Heart}
          title="Здесь пока пусто"
          text="Отмечай треки сердечком — они соберутся здесь."
          action={{ label: 'К поиску', icon: Search, onClick: () => navigate({ name: 'search' }) }}
        />
      ) : (
        <TrackTable tracks={tracks} onPlay={(index) => usePlayer.getState().playList(tracks, index, LIKES_TITLE)} />
      )}
    </>
  );
}
