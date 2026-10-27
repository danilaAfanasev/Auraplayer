import { ListMusic, Music, ThumbsDown, X } from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { dislikeTrack } from '../../stores/blacklistActions';
import { usePlayer } from '../../stores/usePlayer';
import { useWave } from '../../stores/useWave';
import { ArtistLinks } from '../ArtistLinks/ArtistLinks';
import { EmptyState } from '../EmptyState/EmptyState';
import { queueView, rowWindow, type QueueRow } from './queueView';
import styles from './RightPanel.module.css';

/** Сколько строк рисуется разом: очередь в 500+ треков не должна тормозить. */
const WINDOW_ROWS = 120;
/** Окно двигается шагами, а не на каждом треке: список не «ползёт» под курсором. */
const WINDOW_STEP = 40;
/** Сколько строк добавляет кнопка «показать ещё». */
const EXPAND_ROWS = 100;

/** «Убрать из очереди»: именно этот будущий трек (одинаковые объекты — по одному за раз). Волну не выключает. */
function removeFromQueue(track: Track): void {
  let done = false;
  usePlayer.getState().removeUpcoming((t) => {
    if (done || t !== track) return false;
    done = true;
    return true;
  });
}

const QueueItem = memo(function QueueItem({ row }: { row: QueueRow }) {
  const { track, index, state } = row;
  const duration = track.durationSec ? formatDuration(track.durationSec) : '';
  return (
    <li
      className={[styles.queueRow, styles[`queue_${state}`]].join(' ')}
      data-current={state === 'current' || undefined}
      aria-current={state === 'current' ? 'true' : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        className={styles.queueMain}
        title={`Играть «${track.title}»`}
        onClick={() => usePlayer.getState().playAt(index)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          usePlayer.getState().playAt(index);
        }}
      >
        <span className={styles.thumb}>
          {track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy" draggable={false} /> : <Music size={16} />}
        </span>
        <span className={styles.recentMeta}>
          <span className={styles.recentTitle}>{track.title}</span>
          <ArtistLinks artist={track.artist} title={track.title} className={styles.recentArtist} />
        </span>
        {duration && <span className={styles.queueTime}>{duration}</span>}
      </div>
      <span className={styles.queueActions}>
        <button
          type="button"
          className={styles.queueAction}
          title="Не нравится — скрыть этот трек"
          aria-label={`Не нравится: «${track.title}»`}
          onClick={() => dislikeTrack(track)}
        >
          <ThumbsDown size={14} />
        </button>
        {state === 'next' && (
          <button
            type="button"
            className={styles.queueAction}
            title="Убрать из очереди"
            aria-label={`Убрать из очереди: «${track.title}»`}
            onClick={() => removeFromQueue(track)}
          >
            <X size={15} />
          </button>
        )}
      </span>
    </li>
  );
});

/** Очередь: всё, что играет плеер, с первого трека; сыгранные приглушены, текущий подсвечен и виден. */
export function Queue() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const order = usePlayer((s) => s.order);
  const shuffle = usePlayer((s) => s.shuffle);
  const queueTitle = usePlayer((s) => s.queueTitle);
  const waveTitle = useWave((s) => s.active?.title ?? null);
  const listRef = useRef<HTMLUListElement>(null);
  const [extra, setExtra] = useState({ above: 0, below: 0 });

  const view = useMemo(
    () => queueView({ queue, index, shuffle, order, waveTitle, queueTitle }),
    [queue, index, shuffle, order, waveTitle, queueTitle],
  );
  const total = view.rows.length;
  const anchor = view.currentPos < 0 ? -1 : Math.floor(view.currentPos / WINDOW_STEP) * WINDOW_STEP + WINDOW_STEP / 2;
  const { from, to } = rowWindow(total, anchor, WINDOW_ROWS, extra.above, extra.below);
  const shown = view.rows.slice(from, to);
  const currentId = view.currentPos >= 0 ? view.rows[view.currentPos].track.id : null;

  // Трек сменился — подсветка уходит в видимую часть списка (прокручивается сам список, а не окно).
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[data-current]');
    if (!list || !el) return;
    const top = el.offsetTop; // список — position: relative, он же offsetParent
    const bottom = top + el.offsetHeight;
    const visible = top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight;
    if (visible) return;
    list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: scrolled.current ? 'smooth' : 'auto' });
  }, [currentId, view.currentPos, from]);
  useLayoutEffect(() => {
    scrolled.current = total > 0;
  }, [total]);

  return (
    <section className={styles.queueBlock} aria-label="Очередь">
      <header className={styles.blockHeader}>
        <h2 className={styles.queueTitle} title={view.title}>
          {view.title}
        </h2>
        {total > 0 && <span className={styles.queueCount}>{total}</span>}
      </header>
      {total === 0 ? (
        <EmptyState compact icon={ListMusic} title="Очередь пуста" text="Включи что-нибудь — здесь появится очередь" />
      ) : (
        <ul ref={listRef} className={styles.queueList}>
          {from > 0 && (
            <li>
              <button
                type="button"
                className={styles.queueMore}
                onClick={() => setExtra((e) => ({ ...e, above: e.above + EXPAND_ROWS }))}
              >
                Показать выше ({from})
              </button>
            </li>
          )}
          {shown.map((row) => (
            <QueueItem key={row.index} row={row} />
          ))}
          {to < total && (
            <li>
              <button
                type="button"
                className={styles.queueMore}
                onClick={() => setExtra((e) => ({ ...e, below: e.below + EXPAND_ROWS }))}
              >
                Показать ниже ({total - to})
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
