import { LoaderCircle, Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { formatDuration } from '../../../shared/format';
import { lineIndexAt, type LyricLine } from '../../../shared/lyrics';
import { audioEngine } from '../../audioEngine';
import { useLyrics } from '../../stores/useLyrics';
import { useCurrentTrack, usePlayer } from '../../stores/usePlayer';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { ArtistLinks } from '../ArtistLinks/ArtistLinks';
import { IconButton } from '../Button/Button';
import { Soundwave } from '../Soundwave/Soundwave';
import { lyricsEmptyMessage, plainParagraphs } from './lyricsView';
import styles from './LyricsOverlay.module.css';
import {
  isScrubbing,
  scrollTopFor,
  scrubStart,
  scrubStep,
  targetLine,
  WHEEL_IDLE_MS,
  type ScrubEvent,
  type ScrubState,
} from './scrub';

/** Как часто сверяем строку со звуком: чаще, чем `timeupdate` (~4 раза в секунду), — подсветка не отстаёт. */
const SYNC_INTERVAL_MS = 60;
/** Строчная прокрутка колёсика (`deltaMode` 1) в пикселях. */
const WHEEL_LINE_PX = 32;

/** Полоска прогресса и «1:03 / 2:22» — перематывает на отпускании, как в панели плеера. */
function OverlayProgress() {
  const hasTrack = usePlayer((s) => s.index >= 0 && s.queue.length > 0);
  const position = usePlayer((s) => s.positionSec);
  const duration = usePlayer((s) => s.durationSec);
  const seek = usePlayer((s) => s.seek);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  const max = duration > 0 ? duration : 0;
  const fill = max > 0 ? Math.min(100, (shown / max) * 100) : 0;
  const commit = () => {
    if (drag !== null) seek(drag);
    setDrag(null);
  };
  return (
    <div className={styles.progress}>
      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.1}
        value={max > 0 ? Math.min(shown, max) : 0}
        aria-label="Позиция трека"
        style={{ '--fill': `${fill}%` } as CSSProperties}
        disabled={!hasTrack || max === 0}
        onPointerDown={() => setDrag(position)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (drag !== null) setDrag(v);
          else seek(v);
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onBlur={commit}
      />
      <span className={styles.times}>
        {formatDuration(hasTrack ? shown : 0)} / {hasTrack && max > 0 ? formatDuration(max) : formatDuration(0)}
      </span>
    </div>
  );
}

/** «Назад / пауза / дальше». */
function OverlayTransport() {
  const hasTrack = usePlayer((s) => s.index >= 0 && s.queue.length > 0);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);
  const { toggle, next, prev } = usePlayer.getState();
  const playLabel = isLoading ? 'Загрузка…' : isPlaying ? 'Пауза' : 'Играть';
  return (
    <div className={styles.transport}>
      <IconButton icon={SkipBack} size="large" label="Предыдущий" filled disabled={!hasTrack} onClick={prev} />
      <button type="button" className={styles.play} aria-label={playLabel} title={playLabel} disabled={!hasTrack} onClick={toggle}>
        {isLoading ? (
          <LoaderCircle size={24} className="spin" />
        ) : isPlaying ? (
          <Pause size={22} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play size={22} fill="currentColor" strokeWidth={0} className={styles.playIcon} />
        )}
      </button>
      <IconButton icon={SkipForward} size="large" label="Следующий" filled disabled={!hasTrack} onClick={next} />
    </div>
  );
}

/**
 * Синхронный текст: текущая строка — цветом темы и крупнее, автопрокрутка держит её у центральной отметки.
 * Текст можно мотать перетаскиванием и колёсиком (пока мотаешь — автопрокрутка стоит, у отметки строка-цель и её время),
 * трек перематывается один раз — на отпускании / когда колёсико замолчало. Клик по строке (Enter) — перемотка на неё.
 */
function SyncedText({ lines }: { lines: LyricLine[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const lineEls = useRef<(HTMLElement | null)[]>([]);
  /** Центры строк в координатах содержимого окна (`offsetTop` + половина высоты); перечитываются при смене размеров. */
  const centers = useRef<number[]>([]);
  const skip = useMemo(() => lines.map((l) => l.text === ''), [lines]);
  const linesRef = useRef(lines);
  const skipRef = useRef(skip);
  linesRef.current = lines;
  skipRef.current = skip;

  const [viewHeight, setViewHeight] = useState(0);
  const [active, setActive] = useState(-1);
  const [scrubbing, setScrubbing] = useState(false);
  const [target, setTarget] = useState(-1);
  const scrub = useRef<ScrubState>(scrubStart);
  const drag = useRef({ startY: 0, startScrollTop: 0 });
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Клик после перетаскивания — не перемотка на строку под курсором. */
  const suppressClick = useRef(false);

  const readCenters = useCallback(() => {
    centers.current = lineEls.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : Infinity));
  }, []);

  const centerOn = useCallback((index: number, behavior: ScrollBehavior) => {
    const box = boxRef.current;
    const center = centers.current[Math.max(index, 0)];
    if (!box || center === undefined || !Number.isFinite(center)) return;
    box.scrollTo({ top: scrollTopFor(center, box.clientHeight), behavior });
  }, []);

  const updateTarget = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    setTarget(targetLine(centers.current, box.scrollTop + box.clientHeight / 2, skipRef.current));
  }, []);

  const commit = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const index = targetLine(centers.current, box.scrollTop + box.clientHeight / 2, skipRef.current);
    if (index < 0) return;
    usePlayer.getState().seek(linesRef.current[index].timeSec);
    setActive(index);
  }, []);

  const dispatch = useCallback(
    (event: ScrubEvent): ScrubState => {
      const before = scrub.current;
      const result = scrubStep(before, event);
      scrub.current = result.state;
      const now = isScrubbing(result.state);
      if (now !== isScrubbing(before)) setScrubbing(now);
      if (result.commit) commit();
      return before;
    },
    [commit],
  );

  /** Останавливает плавную автопрокрутку на месте (мотать начинают с того, что видно). */
  const freeze = useCallback(() => {
    const box = boxRef.current;
    if (box) box.scrollTo({ top: box.scrollTop, behavior: 'auto' });
  }, []);

  // Размер окна текста и положение строк: поля сверху и снизу в полокна — первая и последняя строки доходят до отметки.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setViewHeight(box.clientHeight);
    const observer = new ResizeObserver(() => {
      setViewHeight(box.clientHeight);
      readCenters();
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [readCenters]);

  useLayoutEffect(() => {
    if (viewHeight === 0) return;
    readCenters();
    if (!isScrubbing(scrub.current)) centerOn(active, 'auto');
    // `active` намеренно не в зависимостях: пересчёт только при смене размеров и строк
  }, [viewHeight, lines, readCenters, centerOn]);

  // Строка по звуку. Играет — читаем время прямо из элемента (точнее `timeupdate`), на паузе и при загрузке — позиция плеера.
  useEffect(() => {
    const sync = () => {
      const p = usePlayer.getState();
      const sec = p.isPlaying && !p.isLoading ? audioEngine.currentTime : p.positionSec;
      setActive(lineIndexAt(lines, sec));
    };
    sync();
    const id = setInterval(sync, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [lines]);

  // Автопрокрутка: новая текущая строка встаёт к отметке; пока мотают — стоит.
  const firstScroll = useRef(true);
  useEffect(() => {
    if (scrubbing || viewHeight === 0) return;
    centerOn(active, firstScroll.current ? 'auto' : 'smooth');
    firstScroll.current = false;
    // размеры обрабатывает эффект выше
  }, [active, scrubbing, centerOn]);

  // Колёсико — своя прокрутка (иначе браузер крутит сам и плавно); нужен не пассивный слушатель.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const phase = scrub.current.phase;
      if (phase === 'pressed' || phase === 'dragging') return;
      const dy = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaMode === 2 ? e.deltaY * box.clientHeight : e.deltaY;
      if (phase === 'idle') freeze();
      box.scrollTop += dy;
      dispatch({ type: 'wheel', at: performance.now() });
      updateTarget();
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
        dispatch({ type: 'tick', at: performance.now() });
      }, WHEEL_IDLE_MS + 10);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      box.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [dispatch, freeze, updateTarget]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const box = boxRef.current;
    if (!box) return;
    if (wheelTimer.current) {
      clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
    }
    freeze();
    drag.current = { startY: e.clientY, startScrollTop: box.scrollTop };
    dispatch({ type: 'down', x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box || (scrub.current.phase !== 'pressed' && scrub.current.phase !== 'dragging')) return;
    const before = dispatch({ type: 'move', x: e.clientX, y: e.clientY });
    if (scrub.current.phase !== 'dragging') return;
    if (before.phase !== 'dragging') box.setPointerCapture(e.pointerId);
    box.scrollTop = drag.current.startScrollTop - (e.clientY - drag.current.startY);
    updateTarget();
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>, type: 'up' | 'cancel') => {
    const box = boxRef.current;
    if (box?.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
    const before = dispatch({ type });
    if (before.phase === 'dragging') {
      // За перетаскиванием браузер шлёт click — он не должен перемотать на строку под курсором.
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
  };

  const seekTo = (index: number) => {
    if (suppressClick.current) return;
    usePlayer.getState().seek(lines[index].timeSec);
    setActive(index);
  };

  const marker = scrubbing ? target : active;
  const pad = viewHeight / 2;
  return (
    <div className={styles.textWrap}>
      <div
        ref={boxRef}
        className={[styles.synced, scrubbing ? styles.scrubbing : ''].filter(Boolean).join(' ')}
        style={{ paddingBlock: pad }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, 'up')}
        onPointerCancel={(e) => onPointerEnd(e, 'cancel')}
      >
        {lines.map((line, i) =>
          line.text === '' ? (
            <div key={i} ref={(el) => void (lineEls.current[i] = el)} className={styles.gap} aria-hidden="true" />
          ) : (
            <button
              key={i}
              ref={(el) => void (lineEls.current[i] = el)}
              type="button"
              className={styles.line}
              data-state={i === marker ? 'current' : i < marker ? 'played' : 'future'}
              onClick={() => seekTo(i)}
            >
              {line.text}
            </button>
          ),
        )}
      </div>
      <div className={[styles.mark, scrubbing ? styles.markOn : ''].filter(Boolean).join(' ')} aria-hidden="true">
        <span className={styles.markTime}>{target >= 0 && lines[target] ? formatDuration(lines[target].timeSec) : ''}</span>
      </div>
    </div>
  );
}

/** Простой текст (без времени): просто прокручивается, без подсветки и перемотки. */
function PlainText({ text }: { text: string }) {
  const paragraphs = useMemo(() => plainParagraphs(text), [text]);
  return (
    <div className={styles.textWrap}>
      <div className={styles.plain}>
        {paragraphs.map((lines, i) => (
          <p key={i} className={styles.paragraph}>
            {lines.map((line, j) => (
              <span key={j} className={styles.plainLine}>
                {line}
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}

function LyricsLayer() {
  const track = useCurrentTrack();
  const status = useLyrics((s) => s.status);
  const lyrics = useLyrics((s) => s.lyrics);
  const soundwave = useSettings((s) => s.settings.soundwave);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => useLyrics.getState().setOpen(false), []);

  // Esc сворачивает (если его уже не взяло меню или окошко); уход на другой экран — тоже.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    const unsubscribe = useUi.subscribe((s, prev) => {
      if (s.screen !== prev.screen) close();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      unsubscribe();
    };
  }, [close]);

  // Фокус — на «Свернуть»; при закрытии возвращается туда, откуда открыли.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const shown = lyrics && status === 'ready' ? lyrics : null;
  return (
    <div className={styles.root} role="dialog" aria-modal="true" aria-label="Текст песни">
      <div className={styles.shade} aria-hidden="true" />
      {soundwave && <Soundwave />}
      <header className={styles.head}>
        <button ref={closeRef} type="button" className={styles.closeButton} title="Свернуть текст (Esc)" onClick={close}>
          Свернуть
        </button>
        <div className={styles.headTitle}>
          Текст{track ? ' · ' : ''}
          {track && <span className={styles.headTrack}>{track.title}</span>}
          {track && ` — ${track.artist}`}
        </div>
        <div className={styles.headSpacer} />
      </header>
      <div className={styles.body}>
        <aside className={styles.side}>
          <div className={styles.info}>
            <div className={styles.cover}>
              {track?.coverUrl ? <img key={track.coverUrl} src={track.coverUrl} alt="" draggable={false} /> : <Music size={56} strokeWidth={1.6} />}
            </div>
            <div className={styles.names}>
              <div className={styles.title} title={track?.title}>
                {track?.title ?? 'Ничего не играет'}
              </div>
              {track && <ArtistLinks artist={track.artist} title={track.title} className={styles.artist} />}
            </div>
          </div>
          <div className={styles.controls}>
            <OverlayProgress />
            <OverlayTransport />
          </div>
        </aside>
        <section className={styles.text} aria-label="Текст">
          {shown?.kind === 'synced' ? (
            <SyncedText key={track?.id} lines={shown.lines} />
          ) : shown?.kind === 'plain' ? (
            <PlainText key={track?.id} text={shown.text} />
          ) : (
            <div className={styles.empty}>{lyricsEmptyMessage(status)}</div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Текст песни на весь экран, поверх всего, кроме заголовка окна (макет `LyricsFull`): саундвейв виден на фоне.
 * Открывает кнопка «Текст» (`useLyrics.open`); «Свернуть» и Esc закрывают. Смена трека — текст нового.
 */
export function LyricsOverlay() {
  const open = useLyrics((s) => s.open);
  return open ? <LyricsLayer /> : null;
}
