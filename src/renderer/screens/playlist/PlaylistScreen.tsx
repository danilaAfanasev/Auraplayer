import { Ellipsis, GripVertical, House, ListMusic, Pencil, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTotalDuration, formatTrackCount } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { IconButton } from '../../components/Button/Button';
import { PlayButtons } from '../../components/PlayButtons/PlayButtons';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import { PlaylistCover } from './PlaylistCover';
import styles from './PlaylistScreen.module.css';

/** Название плейлиста: клик по нему превращает его в поле ввода (Enter — сохранить, Esc — отмена). */
function PlaylistTitle({ id, name, editing, setEditing }: { id: string; name: string; editing: boolean; setEditing(v: boolean): void }) {
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter/Esc и последующая потеря фокуса не должны сохранить дважды.
  const done = useRef(false);

  useEffect(() => {
    if (!editing) return;
    done.current = false;
    setDraft(name);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && draft.trim() && draft.trim() !== name) useLibrary.getState().renamePlaylist(id, draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.titleInput}
        value={draft}
        maxLength={80}
        aria-label="Название плейлиста"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
      />
    );
  }
  return (
    <h1 className={styles.title}>
      <button type="button" className={styles.titleButton} title="Переименовать" onClick={() => setEditing(true)}>
        <span className={styles.titleText}>{name}</span>
        <Pencil size={18} className={styles.titlePencil} />
      </button>
    </h1>
  );
}

/** Меню «…»: переименовать и удалить плейлист. */
function MoreMenu({ onRename, onDelete }: { onRename(): void; onDelete(): void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={styles.more}>
      <IconButton icon={Ellipsis} size="large" label="Ещё" active={open} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div role="menu" className={styles.menu}>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <Pencil size={17} /> Переименовать
          </button>
          <button
            type="button"
            role="menuitem"
            className={[styles.menuItem, styles.menuDanger].join(' ')}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={17} /> Удалить плейлист
          </button>
        </div>
      )}
    </div>
  );
}

/** Страница плейлиста. `param` — id плейлиста. */
export function PlaylistScreen({ param = '' }: { param?: string }) {
  const playlist = useLibrary((s) => s.lib.playlists.find((p) => p.id === param));
  const known = useLibrary((s) => s.lib.tracks);
  const navigate = useUi((s) => s.navigate);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Недоступный трек остаётся в списке: метаданные лежат в библиотеке.
  const tracks = useMemo<Track[]>(
    () => (playlist ? playlist.trackIds.map((id) => known[id]).filter((t): t is Track => Boolean(t)) : []),
    [playlist, known],
  );

  if (!playlist) {
    return (
      <EmptyState
        icon={ListMusic}
        title="Плейлист не найден"
        text="Возможно, его удалили."
        action={{ label: 'На главную', icon: House, onClick: () => navigate({ name: 'home' }) }}
      />
    );
  }

  const count = tracks.length;
  const totalSec = tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0);
  const meta = [formatTrackCount(count), totalSec > 0 ? formatTotalDuration(totalSec) : null]
    .filter(Boolean)
    .join(' · ');

  const remove = () => {
    useLibrary.getState().deletePlaylist(playlist.id);
    setConfirmDelete(false);
    navigate({ name: 'home' });
    useUi.getState().toast(`Плейлист «${playlist.name}» удалён`);
  };

  return (
    <>
      <header className={styles.head}>
        <PlaylistCover tracks={tracks} />
        <div className={styles.info}>
          <div className={styles.eyebrow}>Плейлист</div>
          <PlaylistTitle id={playlist.id} name={playlist.name} editing={editing} setEditing={setEditing} />
          <div className={styles.meta}>{meta}</div>
          <div className={styles.actions}>
            <PlayButtons tracks={tracks} disabled={count === 0} title={playlist.name} />
            <MoreMenu onRename={() => setEditing(true)} onDelete={() => setConfirmDelete(true)} />
          </div>
        </div>
      </header>

      {count === 0 ? (
        <EmptyState
          icon={ListMusic}
          title="В плейлисте пока нет треков"
          text="Найди треки в поиске и добавь их кнопкой +"
          action={{ label: 'К поиску', icon: Search, onClick: () => navigate({ name: 'search' }) }}
        />
      ) : (
        <>
          <p className={styles.hint}>
            <GripVertical size={14} /> Перетаскивай строки, чтобы поменять порядок
          </p>
          <TrackTable
            tracks={tracks}
            playlistId={playlist.id}
            onPlay={(index) => usePlayer.getState().playList(tracks, index, playlist.name)}
          />
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить плейлист?"
          text={`«${playlist.name}» исчезнет из библиотеки. Сами треки останутся в поиске и в других плейлистах.`}
          confirmLabel="Удалить"
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
