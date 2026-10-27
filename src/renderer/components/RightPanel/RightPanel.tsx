import { ChevronRight, History as HistoryIcon, Music, Play } from 'lucide-react';
import { useMemo } from 'react';
import { timeAgo } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';
import { ArtistLinks } from '../ArtistLinks/ArtistLinks';
import { EmptyState } from '../EmptyState/EmptyState';
import { useNow } from '../useNow';
import { openTrackMenu, openTrackMenuByKey } from '../TrackMenu/TrackMenu';
import { Queue } from './Queue';
import { RECENT_BLOCK_TITLE, RECENT_QUEUE_TITLE } from './queueView';
import styles from './RightPanel.module.css';

const RECENT_COUNT = 5;

function Recent() {
  const navigate = useUi((s) => s.navigate);
  const history = useLibrary((s) => s.lib.history);
  const known = useLibrary((s) => s.lib.tracks);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const now = useNow();
  // Очередь по клику — вся история, а на экране — пять последних.
  const entries = useMemo(() => history.filter((h) => known[h.trackId]), [history, known]);
  const queue = useMemo<Track[]>(() => entries.map((h) => known[h.trackId]), [entries, known]);

  return (
    <section className={styles.block}>
      <header className={styles.blockHeader}>
        <h2>{RECENT_BLOCK_TITLE}</h2>
        <button type="button" className={styles.more} onClick={() => navigate({ name: 'history' })}>
          Все <ChevronRight size={14} />
        </button>
      </header>
      {entries.length === 0 ? (
        <EmptyState compact icon={HistoryIcon} title="Пока пусто" text="Здесь появятся треки, которые ты слушал" />
      ) : (
        <ul className={styles.recent}>
          {entries.slice(0, RECENT_COUNT).map((h, index) => {
            const t = known[h.trackId];
            return (
              <li key={h.trackId}>
                <div
                  role="button"
                  tabIndex={0}
                  className={[styles.recentItem, t.id === currentId ? styles.recentCurrent : ''].join(' ')}
                  title={`Играть «${t.title}»`}
                  aria-haspopup="menu"
                  onClick={() => usePlayer.getState().playList(queue, index, RECENT_QUEUE_TITLE)}
                  onContextMenu={(e) => openTrackMenu(e, t, 'recent')}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || openTrackMenuByKey(e, t, 'recent')) return;
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    usePlayer.getState().playList(queue, index, RECENT_QUEUE_TITLE);
                  }}
                >
                  <div className={styles.thumb}>
                    {t.coverUrl ? <img src={t.coverUrl} alt="" loading="lazy" draggable={false} /> : <Music size={16} />}
                    <span className={styles.thumbPlay}>
                      <Play size={14} fill="currentColor" strokeWidth={0} />
                    </span>
                  </div>
                  <div className={styles.recentMeta}>
                    <div className={styles.recentTitle}>{t.title}</div>
                    <ArtistLinks artist={t.artist} title={t.title} className={styles.recentArtist} />
                  </div>
                  <div className={styles.ago}>{timeAgo(h.playedAt, now)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Правая колонка: «Недавно» сверху, ниже — «Очередь» (весь список, который играет плеер). */
export function RightPanel() {
  return (
    <aside className={styles.panel}>
      <Recent />
      <Queue />
    </aside>
  );
}
