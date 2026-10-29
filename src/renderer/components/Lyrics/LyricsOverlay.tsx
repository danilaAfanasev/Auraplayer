import { LoaderCircle, Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from 'react';
import { formatDuration } from '../../../shared/format';
import { lineIndexAt, type LyricLine } from '../../../shared/lyrics';
import { audioEngine } from '../../audioEngine';
import { useLyrics } from '../../stores/useLyrics';
import { useCurrentTrack, usePlayer } from '../../stores/usePlayer';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { ArtistLinks } from '../ArtistLinks/ArtistLinks';
import { IconButton } from '../Button/Button';
import { ThumbRange } from '../ProgressThumb/ThumbRange';
import { Soundwave, type SoundwaveCenter } from '../Soundwave/Soundwave';
import {
  closeAnimations,
  currentClipRadius,
  ENTER_ATTR,
  ENTER_SIDE_ATTR,
  linesEnter,
  LYRICS_SETTLE_MS,
  lyricsButtonCenter,
  openAnimations,
  prefersReducedMotion,
} from './lyricsMotion';
import { ladderLayout, lyricsEmptyMessage, plainParagraphs } from './lyricsView';
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
/** Смена строки: лесенка и сдвиг текста — за столько мс, одной кривой (как `.line` в CSS). */
const LADDER_MS = 300;
const LADDER_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Кольцо саундвейва вокруг обложки — чуть шире её половины. */
const COVER_RING = 1.08;

/** Фаза слоя: раскрывается, открыт, сворачивается (после сворачивания слоя нет). */
export type LyricsPhase = 'opening' | 'open' | 'closing';

/** Сдвиг по вертикали из текущего `transform` элемента (посреди анимации), px. */
function translateYOf(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
}

/** Полоска прогресса на ширину обложки, под ней время по краям — перематывает на отпускании, как в панели плеера. */
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
      <ThumbRange
        fill={fill}
        min={0}
        max={max || 1}
        step={0.1}
        value={max > 0 ? Math.min(shown, max) : 0}
        aria-label="Позиция трека"
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
      <div className={styles.times}>
        <span>{formatDuration(hasTrack ? shown : 0)}</span>
        <span>{hasTrack && max > 0 ? formatDuration(max) : formatDuration(0)}</span>
      </div>
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
 * Синхронный текст лесенкой: текущая строка — крупная и цветом темы, соседние ступенями мельче и прозрачнее
 * (`ladderLayout`); автопрокрутка держит текущую у центральной отметки. Вёрстка строк не меняется — только
 * `transform`/`opacity`, а сдвиг текста при смене строки — та же анимация (прокрутка сразу + сдвиг обёртки к нулю),
 * поэтому всё едет одним движением и строка в две строки не толкает соседей. Текст можно мотать перетаскиванием
 * и колёсиком (пока мотаешь — лесенка от строки-цели, у отметки её время), трек перематывается один раз — на
 * отпускании / когда колёсико замолчало. Клик по строке (Enter) — перемотка на неё.
 */
function SyncedText({ lines }: { lines: LyricLine[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lineEls = useRef<(HTMLElement | null)[]>([]);
  /** Центры строк в координатах содержимого окна (`offsetTop` + половина высоты); перечитываются при смене размеров. */
  const centers = useRef<number[]>([]);
  const skip = useMemo(() => lines.map((l) => l.text === ''), [lines]);
  const linesRef = useRef(lines);
  const skipRef = useRef(skip);
  linesRef.current = lines;
  skipRef.current = skip;

  const [viewHeight, setViewHeight] = useState(0);
  /** Высоты строк в вёрстке — из них лесенка считает, на сколько подтянуть уменьшенные строки. */
  const [heights, setHeights] = useState<number[]>([]);
  /** Первый кадр стоит без переходов: лесенка встаёт сразу, а не наезжает из «плоского» текста. */
  const [animated, setAnimated] = useState(false);
  const [active, setActive] = useState(-1);
  const [scrubbing, setScrubbing] = useState(false);
  const [target, setTarget] = useState(-1);
  const scrub = useRef<ScrubState>(scrubStart);
  const drag = useRef({ startY: 0, startScrollTop: 0 });
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Сдвиг текста к новой строке (FLIP обёртки строк). */
  const slide = useRef<Animation | null>(null);
  /** Клик после перетаскивания — не перемотка на строку под курсором. */
  const suppressClick = useRef(false);

  const readCenters = useCallback(() => {
    const base = listRef.current?.offsetTop ?? 0;
    centers.current = lineEls.current.map((el) => (el ? base + el.offsetTop + el.offsetHeight / 2 : Infinity));
    const next = lineEls.current.map((el) => el?.offsetHeight ?? 0);
    setHeights((prev) => (prev.length === next.length && prev.every((h, i) => h === next[i]) ? prev : next));
  }, []);

  /** Ставит строку к отметке: прокрутка — сразу; `animate` — текст доезжает плавно (сдвиг обёртки к нулю). */
  const centerOn = useCallback((index: number, animate: boolean) => {
    const box = boxRef.current;
    const list = listRef.current;
    const center = centers.current[Math.max(index, 0)];
    if (!box || !list || center === undefined || !Number.isFinite(center)) return;
    const top = scrollTopFor(center, box.clientHeight);
    // Посреди прошлого сдвига текст ещё не доехал: новый сдвиг начинается оттуда, где текст виден сейчас.
    const from = top - box.scrollTop + (slide.current ? translateYOf(list) : 0);
    slide.current?.cancel();
    slide.current = null;
    box.scrollTop = top;
    if (!animate || Math.abs(from) < 0.5 || prefersReducedMotion()) return;
    const anim = list.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], { duration: LADDER_MS, easing: LADDER_EASE });
    slide.current = anim;
    anim.onfinish = () => {
      if (slide.current === anim) slide.current = null;
    };
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

  /** Доводит сдвиг текста до конца (мотать начинают с того, что видно, и прокрутка совпадает с видимым). */
  const freeze = useCallback(() => {
    slide.current?.finish();
    slide.current = null;
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
    if (!isScrubbing(scrub.current)) centerOn(active, false);
    // `active` намеренно не в зависимостях: пересчёт только при смене размеров и строк
  }, [viewHeight, lines, readCenters, centerOn]);

  // Строки измерены и лесенка стоит — дальше её смены плавные.
  useEffect(() => {
    if (animated || heights.length === 0) return;
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [heights, animated]);

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
    centerOn(active, !firstScroll.current);
    firstScroll.current = false;
    // размеры обрабатывает эффект выше
  }, [active, scrubbing, centerOn]);

  useEffect(
    () => () => {
      slide.current?.cancel();
    },
    [],
  );

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

  // Лесенка — от текущей строки, а пока мотают — от строки-цели у отметки.
  const marker = scrubbing ? target : active;
  const ladder = useMemo(
    () => ladderLayout(heights.length === lines.length ? heights : lines.map(() => 0), skip, marker),
    [heights, lines, skip, marker],
  );
  const pad = viewHeight / 2;
  return (
    <div className={styles.textWrap}>
      <div
        ref={boxRef}
        className={[styles.synced, scrubbing ? styles.scrubbing : ''].filter(Boolean).join(' ')}
        data-animated={animated ? '' : undefined}
        style={{ paddingBlock: pad }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, 'up')}
        onPointerCancel={(e) => onPointerEnd(e, 'cancel')}
      >
        <div ref={listRef} className={styles.lines}>
          {lines.map((line, i) =>
            line.text === '' ? (
              <div key={i} ref={(el) => void (lineEls.current[i] = el)} className={styles.gap} aria-hidden="true" />
            ) : (
              <button
                key={i}
                ref={(el) => void (lineEls.current[i] = el)}
                type="button"
                className={styles.line}
                data-state={i === marker ? 'current' : undefined}
                style={
                  {
                    transform: `translateY(${ladder[i].shift.toFixed(2)}px) scale(${ladder[i].scale})`,
                    '--ladder-opacity': ladder[i].opacity,
                  } as CSSProperties
                }
                onClick={() => seekTo(i)}
              >
                <span className={styles.lineText} {...{ [ENTER_ATTR]: '' }}>
                  {line.text}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
      <div className={[styles.mark, scrubbing ? styles.markOn : ''].filter(Boolean).join(' ')} aria-hidden="true">
        <span className={styles.markTime}>{target >= 0 && lines[target] ? formatDuration(lines[target].timeSec) : ''}</span>
      </div>
    </div>
  );
}

/** Простой текст (без времени): просто прокручивается, без подсветки, лесенки и перемотки. */
function PlainText({ text }: { text: string }) {
  const paragraphs = useMemo(() => plainParagraphs(text), [text]);
  return (
    <div className={styles.textWrap}>
      <div className={styles.plain}>
        {paragraphs.map((lines, i) => (
          <p key={i} className={styles.paragraph} {...{ [ENTER_ATTR]: '' }}>
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

/** Центр обложки в окне по вёрстке (без `transform` анимации) и радиус кольца вокруг неё. */
function useCoverRing(coverRef: RefObject<HTMLElement | null>): SoundwaveCenter | null {
  const [ring, setRing] = useState<SoundwaveCenter | null>(null);
  useLayoutEffect(() => {
    const el = coverRef.current;
    if (!el) return;
    const measure = (): void => {
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      const w = el.offsetWidth;
      const next = { x: Math.round(x + w / 2), y: Math.round(y + el.offsetHeight / 2), radius: Math.round((w / 2) * COVER_RING) };
      setRing((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.radius === next.radius ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [coverRef]);
  return ring;
}

interface LayerProps {
  open: boolean;
  onPhase(phase: LyricsPhase): void;
  onClosed(): void;
}

function LyricsLayer({ open, onPhase, onClosed }: LayerProps) {
  const track = useCurrentTrack();
  const status = useLyrics((s) => s.status);
  const lyrics = useLyrics((s) => s.lyrics);
  const soundwave = useSettings((s) => s.settings.soundwave);
  const rootRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => useLyrics.getState().setOpen(false), []);
  const ring = useCoverRing(coverRef);

  const [phase, setPhase] = useState<LyricsPhase>('opening');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const callbacks = useRef({ onPhase, onClosed });
  callbacks.current = { onPhase, onClosed };
  const anims = useRef<Animation[]>([]);
  const run = useRef(0);

  useEffect(() => {
    callbacks.current.onPhase(phase);
  }, [phase]);

  // Открытие и закрытие. Сменили направление посреди анимации — круг идёт обратно с того радиуса, где был.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mine = ++run.current;
    const radius = currentClipRadius(root);
    for (const a of anims.current) a.cancel();
    // Конец — когда доиграли все анимации или (окно свёрнуто, кадров нет) по таймеру; сменили направление — не наш.
    const settle = (list: Animation[], done: () => void): void => {
      let fired = false;
      const fire = (): void => {
        if (fired || mine !== run.current) return;
        fired = true;
        done();
      };
      void Promise.all(list.map((a) => a.finished)).then(fire, () => undefined);
      setTimeout(fire, LYRICS_SETTLE_MS);
    };
    if (open) {
      const from = phaseRef.current === 'closing' ? (radius ?? 0) : 0;
      setPhase('opening');
      const list = openAnimations(root, coverRef.current, useLyrics.getState().origin, from);
      anims.current = list;
      settle(list, () => setPhase('open'));
      // Строки въезжают, когда текст уже прокручен к текущей (это делают эффекты строк) — со следующего кадра.
      const frame = from === 0 ? requestAnimationFrame(() => mine === run.current && anims.current.push(...linesEnter(root))) : 0;
      return () => cancelAnimationFrame(frame);
    }
    setPhase('closing');
    const origin = lyricsButtonCenter() ?? useLyrics.getState().origin;
    const list = closeAnimations(root, coverRef.current, origin, phaseRef.current === 'opening' ? radius : null);
    anims.current = list;
    settle(list, () => callbacks.current.onClosed());
    return undefined;
  }, [open]);

  useEffect(
    () => () => {
      run.current++;
      for (const a of anims.current) a.cancel();
    },
    [],
  );

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

  // Фокус — на «Свернуть»; когда слой исчез, возвращается туда, откуда открыли.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const shown = lyrics && status === 'ready' ? lyrics : null;
  return (
    <div ref={rootRef} className={styles.root} data-phase={phase} role="dialog" aria-modal="true" aria-label="Текст песни">
      <div className={styles.shade} aria-hidden="true" />
      {soundwave && <Soundwave center={ring} />}
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
          <div ref={coverRef} className={styles.cover}>
            {track?.coverUrl ? <img key={track.coverUrl} src={track.coverUrl} alt="" draggable={false} /> : <Music size={56} strokeWidth={1.6} />}
          </div>
          <div className={styles.names} {...{ [ENTER_SIDE_ATTR]: '' }}>
            <div className={styles.title} title={track?.title}>
              {track?.title ?? 'Ничего не играет'}
            </div>
            {track && <ArtistLinks artist={track.artist} title={track.title} className={styles.artist} />}
          </div>
          <div className={styles.controls} {...{ [ENTER_SIDE_ATTR]: '' }}>
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
            <div className={styles.empty} {...{ [ENTER_ATTR]: '' }}>
              {lyricsEmptyMessage(status)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Текст песни на весь экран, поверх всего, кроме заголовка окна (макет `LyricsA`): обложка слева, текст справа,
 * саундвейв на фоне. Открывает кнопка «Текст» (`useLyrics.open`) — слой раскрывается кругом из неё; «Свернуть»,
 * Esc и смена экрана сворачивают его обратно в кнопку, слой исчезает после анимации. Смена трека — текст нового.
 * `onPhaseChange` — фаза слоя для окна (`null` — слоя нет).
 */
export function LyricsOverlay({ onPhaseChange }: { onPhaseChange?: (phase: LyricsPhase | null) => void }) {
  const open = useLyrics((s) => s.open);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const report = useRef(onPhaseChange);
  report.current = onPhaseChange;
  const onPhase = useCallback((phase: LyricsPhase) => report.current?.(phase), []);
  const onClosed = useCallback(() => {
    setMounted(false);
    report.current?.(null);
  }, []);
  return mounted ? <LyricsLayer open={open} onPhase={onPhase} onClosed={onClosed} /> : null;
}
