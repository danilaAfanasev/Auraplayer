import { FolderOpen, RefreshCw, Settings } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { formatTrackCount, pluralRu } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { IconButton } from '../../components/Button/Button';
import { PlayButtons } from '../../components/PlayButtons/PlayButtons';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { usePlayer } from '../../stores/usePlayer';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { MissingBadge } from '../downloads/MissingBadge';
import styles from './LocalScreen.module.css';
import { useLocalTracks, type LocalTrack } from './useLocalTracks';

/** Заголовок экрана и очереди, которую он включает. */
const LOCAL_TITLE = 'Мои файлы';

let rescannedThisSession = false;

/** «Мои файлы»: музыка из папок пользователя (папки задаются в настройках). */
export function LocalScreen() {
  const navigate = useUi((s) => s.navigate);
  const folders = useSettings((s) => s.settings.localFolders);
  const tracks = useLocalTracks((s) => s.tracks);
  const loaded = useLocalTracks((s) => s.loaded);
  const scanning = useLocalTracks((s) => s.scanning);
  const count = tracks.length;

  useEffect(() => {
    const store = useLocalTracks.getState();
    // Первый заход за сеанс — тихое пересканирование (неизменившиеся файлы не читаются заново).
    if (!rescannedThisSession && folders.length > 0) {
      rescannedThisSession = true;
      void store.load().then(() => store.rescan());
    } else {
      void store.load();
    }
  }, [folders]);

  const rescan = async () => {
    const found = await useLocalTracks.getState().rescan();
    if (found !== null) useUi.getState().toast(`Найдено ${formatTrackCount(found)}`);
  };

  const rowActions = useCallback(
    (track: Track) => <span className={styles.slot}>{(track as LocalTrack).missing ? <MissingBadge /> : null}</span>,
    [],
  );
  const missingCount = tracks.filter((t) => t.missing).length;
  const openSettings = () => navigate({ name: 'settings' });

  if (folders.length === 0) {
    return (
      <>
        <ScreenHeader eyebrow="Библиотека" title={LOCAL_TITLE} />
        <EmptyState
          icon={FolderOpen}
          title="Добавь папки с музыкой"
          text="Укажи папки в настройках — Aura найдёт в них mp3, m4a, flac, ogg, opus и wav."
          action={{ label: 'Открыть настройки', icon: Settings, onClick: openSettings }}
        />
      </>
    );
  }

  const eyebrow = `Библиотека · ${folders.length} ${pluralRu(folders.length, 'папка', 'папки', 'папок')}${
    count > 0 ? ` · ${formatTrackCount(count)}` : ''
  }${missingCount > 0 ? ` · ${missingCount} без файла` : ''}`;

  return (
    <>
      <ScreenHeader
        eyebrow={eyebrow}
        title={LOCAL_TITLE}
        aside={
          <>
            {count > 0 && (
              <PlayButtons tracks={tracks} title={LOCAL_TITLE} />
            )}
            <IconButton
              icon={RefreshCw}
              label={scanning ? 'Ищу музыку…' : 'Пересканировать папки'}
              disabled={scanning}
              className={scanning ? 'spin-inner' : undefined}
              onClick={() => void rescan()}
            />
          </>
        }
      />
      {!loaded ? (
        <SkeletonRows />
      ) : count === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={scanning ? 'Ищу музыку…' : 'В папках пока не нашлось музыки'}
          text="Aura ищет mp3, m4a, flac, ogg, opus и wav во всех вложенных папках."
          action={scanning ? undefined : { label: 'Пересканировать', icon: RefreshCw, onClick: () => void rescan() }}
        />
      ) : (
        <TrackTable tracks={tracks} onPlay={(index) => usePlayer.getState().playList(tracks, index, LOCAL_TITLE)} rowActions={rowActions} />
      )}
    </>
  );
}
