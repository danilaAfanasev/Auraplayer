import { MoreHorizontal, Music, Play, X } from 'lucide-react';
import { memo, useCallback, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { formatDuration } from '../../../shared/format';
import { reorderTarget } from '../../../shared/library';
import type { Track } from '../../../shared/types';
import { restoreArtist, restoreTrack, useBlacklist } from '../../stores/blacklistActions';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';
import { AddToPlaylistButton } from '../AddToPlaylistMenu/AddToPlaylistMenu';
import { ArtistLinks } from '../ArtistLinks/ArtistLinks';
import { IconButton } from '../Button/Button';
import { DownloadButton } from '../DownloadButton/DownloadButton';
import { LikeButton } from '../LikeButton/LikeButton';
import { SourceBadge } from '../SourceBadge/SourceBadge';
import { openTrackMenu, openTrackMenuBelow, openTrackMenuByKey } from '../TrackMenu/TrackMenu';
import { WaveButton } from '../WaveButton/WaveButton';
import { blockedBy, type BlockedBy } from './blockedRow';
import styles from './TrackTable.module.css';

/** Снять скрытие со строки: вернуть записи треков и исполнителей, из-за которых она скрыта. */
function restoreBlocked(by: BlockedBy): void {
  for (const id of by.trackIds) restoreTrack(id);
  for (const key of by.artistKeys) restoreArtist(key);
}

export interface TrackTableProps {
  tracks: Track[];
  /** Играть трек с этим номером (очередь — этот список). */
  onPlay(index: number): void;
  /** Метка источника у каждого трека (по умолчанию — да). */
  showSource?: boolean;
  /** Таблица плейлиста: строки перетаскиваются, у каждой есть «Убрать из плейлиста». */
  playlistId?: string;
  /** Дополнительные действия справа в строке — после встроенных ♥, «+» и «Скачать». */
  rowActions?: (track: Track, index: number) => ReactNode;
  /** Скрыть строку заголовков колонок. */
  hideHeader?: boolean;
  /**
   * Треки из чёрного списка в этом списке (свои списки и поиск): `mute` (по умолчанию) — строка приглушена,
   * пометка «в чёрном списке» и «Вернуть», двойной клик предлагает «Вернуть и включить»; `none` — как обычные.
   * Подборки (чарт, SoundCloud, жанры, артист) убирают скрытые раньше, в своих хуках данных.
   */
  blockedMode?: 'mute' | 'none';
}

/** Анимированный эквалайзер вместо номера у играющего трека; на паузе замирает. */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={[styles.eq, playing ? '' : styles.eqPaused].join(' ')} aria-label={playing ? 'Играет' : 'На паузе'}>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

/** Где бросают перетаскиваемую строку: над строкой `index`, в её верхней или нижней половине. */
interface DropMark {
  index: number;
  after: boolean;
}

interface RowProps {
  track: Track;
  index: number;
  current: boolean;
  playing: boolean;
  showSource: boolean;
  actions: ReactNode;
  /** Трек в чёрном списке — строка приглушена. */
  blocked: BlockedBy | null;
  /** Строка плейлиста: можно перетаскивать и убирать. */
  reorderable: boolean;
  dragging: boolean;
  dropEdge: 'before' | 'after' | null;
  onPlay(index: number): void;
  onRemove(index: number): void;
  onMove(from: number, to: number): void;
  onDragStart(index: number, e: DragEvent<HTMLDivElement>): void;
  onDragOver(index: number, e: DragEvent<HTMLDivElement>): void;
  onDrop(e: DragEvent<HTMLDivElement>): void;
  onDragEnd(): void;
}

const Row = memo(function Row({
  track,
  index,
  current,
  playing,
  showSource,
  actions,
  blocked,
  reorderable,
  dragging,
  dropEdge,
  onPlay: playRow,
  onRemove,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: RowProps) {
  // Скрытый трек сам не включается: сначала — предложение вернуть его.
  const onPlay = (i: number) => {
    if (!blocked) {
      playRow(i);
      return;
    }
    useUi.getState().toast(`«${track.title}» — ${blocked.label}`, {
      label: 'Вернуть и включить',
      run: () => {
        restoreBlocked(blocked);
        playRow(i);
      },
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // Клавиша меню / Shift+F10 — меню трека у строки.
    if (openTrackMenuByKey(e, track, 'table')) return;
    if (e.key === 'Enter') onPlay(index);
    // Alt + стрелка — сдвинуть строку плейлиста без мыши.
    if (reorderable && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onMove(index, index + (e.key === 'ArrowUp' ? -1 : 1));
    }
  };
  return (
    <div
      role="row"
      tabIndex={0}
      className={[
        styles.row,
        current ? styles.current : '',
        blocked ? styles.blocked : '',
        dragging ? styles.dragging : '',
        dropEdge === 'before' ? styles.dropBefore : '',
        dropEdge === 'after' ? styles.dropAfter : '',
      ].join(' ')}
      style={{ '--i': Math.min(index, 14) } as CSSProperties}
      aria-current={current ? 'true' : undefined}
      draggable={reorderable || undefined}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => openTrackMenu(e, track, 'table')}
      onKeyDown={onKeyDown}
      onDragStart={reorderable ? (e) => onDragStart(index, e) : undefined}
      onDragOver={reorderable ? (e) => onDragOver(index, e) : undefined}
      onDrop={reorderable ? onDrop : undefined}
      onDragEnd={reorderable ? onDragEnd : undefined}
    >
      <div role="cell" className={styles.num}>
        {current ? <Equalizer playing={playing} /> : <span className={styles.numText}>{String(index + 1).padStart(2, '0')}</span>}
        <button
          type="button"
          className={styles.rowPlay}
          aria-label={`Играть «${track.title}»`}
          title="Играть"
          onClick={() => onPlay(index)}
        >
          <Play size={14} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
      <div role="cell" className={styles.titleCell}>
        <div className={styles.cover}>
          {track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy" draggable={false} /> : <Music size={16} />}
        </div>
        <div className={styles.meta}>
          <div className={styles.title} title={track.title}>
            {track.title}
          </div>
          <div className={styles.artistLine}>
            {blocked && <span className={styles.blockedTag}>{blocked.label}</span>}
            <ArtistLinks artist={track.artist} title={track.title} className={styles.artist} />
          </div>
        </div>
      </div>
      <div role="cell" className={styles.albumCell}>
        {showSource && <SourceBadge source={track.source} />}
        <span className={styles.album} title={track.album}>
          {track.album ?? ''}
        </span>
      </div>
      <div role="cell" className={styles.time}>
        {formatDuration(track.durationSec)}
      </div>
      <div role="cell" className={styles.actions}>
        {blocked ? (
          <button
            type="button"
            className={styles.restore}
            title={blocked.reason === 'track' ? 'Вернуть трек из чёрного списка' : 'Вернуть исполнителя из чёрного списка'}
            onClick={() => restoreBlocked(blocked)}
          >
            Вернуть
          </button>
        ) : (
          <>
            <LikeButton track={track} />
            <AddToPlaylistButton track={track} />
            <DownloadButton track={track} hideWhenLocal />
            <WaveButton track={track} />
            {actions}
            <IconButton
              icon={MoreHorizontal}
              size="small"
              label="Ещё"
              title="Ещё: «Не нравится», «Играть следующим», исполнитель…"
              aria-haspopup="menu"
              onClick={(e) => {
                e.stopPropagation();
                openTrackMenuBelow(e.currentTarget, track, 'table');
              }}
            />
          </>
        )}
        {reorderable && <IconButton icon={X} size="small" label="Убрать из плейлиста" onClick={() => onRemove(index)} />}
      </div>
    </div>
  );
});

/**
 * Единственная таблица треков приложения: №, название и исполнитель с обложкой, альбом/источник, длительность.
 * В каждой строке уже есть ♥, «+», «Скачать», «Волна по треку» и «⋯» — то же меню трека, что по правому клику;
 * `rowActions` добавляет остальное.
 * С `playlistId` строки перетаскиваются. Скрытые треки — см. `blockedMode`.
 */
export function TrackTable({ tracks, onPlay, showSource = true, playlistId, rowActions, hideHeader = false, blockedMode = 'mute' }: TrackTableProps) {
  const blacklist = useBlacklist();
  const muteBlocked = blockedMode === 'mute' && (blacklist.tracks.length > 0 || blacklist.artists.length > 0);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying || s.isLoading);
  const reorderable = playlistId !== undefined;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropMark | null>(null);

  const move = useCallback(
    (from: number, to: number) => {
      if (playlistId) useLibrary.getState().movePlaylistTrack(playlistId, from, to);
    },
    [playlistId],
  );

  const remove = useCallback(
    (index: number) => {
      if (!playlistId) return;
      const store = useLibrary.getState();
      const playlist = store.lib.playlists.find((p) => p.id === playlistId);
      const track = playlist && store.lib.tracks[playlist.trackIds[index]];
      if (!playlist || !track) return;
      store.removeFromPlaylist(playlistId, track.id);
      useUi.getState().toast(`Убрано из «${playlist.name}»`, {
        label: 'Вернуть',
        run: () => {
          // Трек возвращается на прежнее место.
          const lib = useLibrary.getState();
          if (!lib.addToPlaylist(playlistId, track)) return;
          const last = (useLibrary.getState().lib.playlists.find((p) => p.id === playlistId)?.trackIds.length ?? 1) - 1;
          lib.movePlaylistTrack(playlistId, last, Math.min(index, last));
        },
      });
    },
    [playlistId],
  );

  const onDragStart = useCallback((index: number, e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    setDragIndex(index);
  }, []);

  const onDragOver = useCallback(
    (index: number, e: DragEvent<HTMLDivElement>) => {
      if (dragIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      setDrop((prev) => (prev && prev.index === index && prev.after === after ? prev : { index, after }));
    },
    [dragIndex],
  );

  const onDragEnd = useCallback(() => {
    setDragIndex(null);
    setDrop(null);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (dragIndex !== null && drop) {
        const to = reorderTarget(dragIndex, drop.index, drop.after);
        if (to !== null) move(dragIndex, to);
      }
      onDragEnd();
    },
    [dragIndex, drop, move, onDragEnd],
  );

  return (
    <div role="table" className={styles.table} aria-label="Треки">
      {!hideHeader && (
        <div role="row" className={[styles.row, styles.header].join(' ')}>
          <div role="columnheader" className={styles.num}>
            #
          </div>
          <div role="columnheader">Название</div>
          <div role="columnheader">Альбом</div>
          <div role="columnheader" className={styles.time}>
            Время
          </div>
          <div role="columnheader" className={styles.actions} />
        </div>
      )}
      {tracks.map((track, index) => {
        const current = track.id === currentId;
        return (
          <Row
            // В плейлисте id уникальны: при перестановке строка переезжает, а не создаётся заново.
            key={reorderable ? track.id : `${track.id}:${index}`}
            track={track}
            index={index}
            current={current}
            playing={current && isPlaying}
            showSource={showSource}
            actions={rowActions?.(track, index) ?? null}
            blocked={muteBlocked ? blockedBy(track, blacklist) : null}
            reorderable={reorderable}
            dragging={dragIndex === index}
            dropEdge={drop && drop.index === index && dragIndex !== null ? (drop.after ? 'after' : 'before') : null}
            onPlay={onPlay}
            onRemove={remove}
            onMove={move}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        );
      })}
    </div>
  );
}
