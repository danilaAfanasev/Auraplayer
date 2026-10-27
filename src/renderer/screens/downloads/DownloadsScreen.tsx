import { Download, FolderOpen, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatTrackCount } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { errorMessage } from '../../app/errors';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { IconButton } from '../../components/Button/Button';
import { PlayButtons } from '../../components/PlayButtons/PlayButtons';
import { DownloadButton } from '../../components/DownloadButton/DownloadButton';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { initDownloads, useDownloads, type DownloadEntry } from '../../stores/useDownloads';
import { usePlayer } from '../../stores/usePlayer';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import styles from './DownloadsScreen.module.css';
import { MissingBadge } from './MissingBadge';

/** Заголовок экрана и очереди, которую он включает. */
const DOWNLOADS_TITLE = 'Скачанное';

const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;

/** Показать файл (или папку) в проводнике. */
export function showInFolder(path: string): void {
  window.aura.showInFolder(path).catch((err: unknown) => useUi.getState().toast(errorMessage(err), undefined, 'error'));
}

/**
 * Открыть папку скачивания: если в ней уже есть скачанный файл — проводник откроется внутри папки
 * с этим файлом, иначе — на самой папке.
 */
export function openDownloadDir(dir: string): void {
  const prefix = dir.replace(/[\\/]+$/, '').toLowerCase();
  const inside = Object.values(useDownloads.getState().records).find((r) => {
    const parent = r.filePath.slice(0, Math.max(r.filePath.lastIndexOf('\\'), r.filePath.lastIndexOf('/')));
    return !r.missing && parent.toLowerCase() === prefix;
  });
  showInFolder(inside ? inside.filePath : dir);
}

/** Загрузки, которые идут сейчас: название и кольцо прогресса (клик — отмена). */
function ActiveDownloads() {
  const states = useDownloads((s) => s.states);
  const active = useDownloads((s) => s.active);
  const tracks = Object.keys(states)
    .map((id) => active[id])
    .filter((t): t is Track => Boolean(t));
  if (tracks.length === 0) return null;
  return (
    <section className={styles.active} aria-label="Скачивается сейчас">
      <h2 className={styles.activeTitle}>Скачивается сейчас</h2>
      {tracks.map((t) => {
        const st = states[t.id];
        const progress = st?.status === 'downloading' && st.progress >= 0 ? `${Math.round(st.progress * 100)}%` : 'в очереди';
        return (
          <div key={t.id} className={styles.activeRow}>
            <DownloadButton track={t} />
            <span className={styles.activeName}>
              <ArtistLinks artist={t.artist} title={t.title} /> — {t.title}
            </span>
            <span className={styles.activeProgress}>{st?.status === 'downloading' && st.progress < 0 ? 'скачивается' : progress}</span>
          </div>
        );
      })}
    </section>
  );
}

/** «Скачанное»: все скачанные треки, «Слушать всё», показать файл в папке, удалить файл (с подтверждением). */
export function DownloadsScreen() {
  const navigate = useUi((s) => s.navigate);
  const records = useDownloads((s) => s.records);
  const loaded = useDownloads((s) => s.loaded);
  const downloadDir = useSettings((s) => s.settings.downloadDir);
  const [confirm, setConfirm] = useState<DownloadEntry | null>(null);

  useEffect(() => {
    initDownloads();
    // Каждый заход — заново проверяем, на месте ли файлы.
    void useDownloads.getState().refresh();
  }, []);

  const list = useMemo(() => Object.values(records).sort((a, b) => b.downloadedAt - a.downloadedAt), [records]);
  const tracks = useMemo(() => list.map((r) => r.track), [list]);
  const count = tracks.length;
  const missingCount = useMemo(() => list.filter((r) => r.missing).length, [list]);

  const onRemove = useCallback(async () => {
    const entry = confirm;
    setConfirm(null);
    if (!entry) return;
    if (await useDownloads.getState().remove(entry.trackId)) {
      useUi.getState().toast(entry.missing ? 'Убрано из «Скачанного»' : `Файл «${entry.track.title}» удалён`);
    }
  }, [confirm]);
  const onCancel = useCallback(() => setConfirm(null), []);

  const rowActions = useCallback(
    (track: Track) => {
      const entry = records[track.id];
      if (!entry) return null;
      if (entry.missing) {
        return (
          <>
            <MissingBadge />
            <IconButton icon={X} size="small" label="Убрать из списка" onClick={() => setConfirm(entry)} />
          </>
        );
      }
      return (
        <>
          <IconButton icon={FolderOpen} size="small" label="Показать в папке" onClick={() => showInFolder(entry.filePath)} />
          <IconButton icon={Trash2} size="small" label="Удалить файл" className={styles.dangerIcon} onClick={() => setConfirm(entry)} />
        </>
      );
    },
    [records],
  );

  return (
    <>
      <ScreenHeader
        eyebrow={
          count > 0
            ? `Библиотека · ${formatTrackCount(count)}${
                missingCount > 0 ? ` · ${missingCount} без файла` : ''
              }`
            : 'Библиотека'
        }
        title={DOWNLOADS_TITLE}
        aside={
          <>
            {count > 0 && (
              <PlayButtons tracks={tracks} title={DOWNLOADS_TITLE} />
            )}
            <IconButton icon={FolderOpen} label="Открыть папку скачивания" disabled={!downloadDir} onClick={() => openDownloadDir(downloadDir)} />
          </>
        }
      />
      <ActiveDownloads />
      {!loaded ? (
        <SkeletonRows />
      ) : count === 0 ? (
        <EmptyState
          icon={Download}
          title="Скачанных треков пока нет"
          text="Скачивай треки кнопкой «Скачать» — они будут играть и без интернета."
          action={{ label: 'К поиску', icon: Search, onClick: () => navigate({ name: 'search' }) }}
        />
      ) : (
        <TrackTable tracks={tracks} onPlay={(index) => usePlayer.getState().playList(tracks, index, DOWNLOADS_TITLE)} rowActions={rowActions} />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.missing ? 'Убрать из «Скачанного»?' : 'Удалить файл?'}
          text={
            confirm.missing
              ? `Файла «${confirm.track.title}» уже нет на диске — запись просто исчезнет из списка.`
              : `Файл «${fileName(confirm.filePath)}» будет удалён с диска. Трек останется в плейлистах и будет играть из сети.`
          }
          confirmLabel={confirm.missing ? 'Убрать' : 'Удалить файл'}
          onConfirm={() => void onRemove()}
          onCancel={onCancel}
        />
      )}
    </>
  );
}
