import { Brush, Eraser, PaintBucket, Plus, Redo2, Trash2, Undo2, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { buildPalette, parseHex, toHex } from '../../../shared/palette';
import {
  DEFAULT_THUMB_CHOICE,
  MAX_THUMB_COLORS,
  MAX_THUMB_NAME,
  THUMB_GRID,
  compactThumb,
  emptyPixels,
  floodFill,
  isEmptyThumb,
  setPixel,
  type CustomThumb,
} from '../../../shared/progressThumb';
import { useSettings } from '../../stores/useSettings';
import { Button } from '../Button/Button';
import styles from './ThumbEditor.module.css';
import { EMPTY_THUMB_HISTORY, push, redo as redoStep, undo as undoStep, type ThumbHistory } from './thumbHistory';
import { ThumbRange } from './ThumbRange';

type Tool = 'brush' | 'eraser' | 'fill';

const TOOLS: { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: 'brush', label: 'Кисть', icon: Brush },
  { id: 'eraser', label: 'Ластик', icon: Eraser },
  { id: 'fill', label: 'Заливка', icon: PaintBucket },
];

const COLOR_CHARS = '0123456789abcdef';
/** Клеток в сетке и сторона клетки на холсте (холст рисуется крупно, на странице сжимается стилем). */
const CELLS = THUMB_GRID * THUMB_GRID;
const CELL_PX = 20;
/** Своя чёрная и белая — рядом с цветами темы. */
const BASE_COLORS = ['#000000', '#ffffff'];

interface Props {
  /** Правят готовый значок; без него — новый. */
  initial?: CustomThumb;
  /** Имя для нового значка. */
  defaultName: string;
  onSave(draft: { name: string; palette: string[]; pixels: string }): void;
  onClose(): void;
}

/** Клетки отрезка между двумя клетками (Брезенхем): быстрая кисть не оставляет дыр. */
function cellsBetween(from: number, to: number): number[] {
  let x = from % THUMB_GRID;
  let y = Math.floor(from / THUMB_GRID);
  const x1 = to % THUMB_GRID;
  const y1 = Math.floor(to / THUMB_GRID);
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  const cells = [y * THUMB_GRID + x];
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    cells.push(y * THUMB_GRID + x);
  }
  return cells;
}

/** Цвета темы для палитры: акцент, текст и т. п. — те же, что в интерфейсе, плюс чёрный и белый. */
function themeColors(accent: string, background: string): string[] {
  const vars = buildPalette(accent, background);
  const colors = ['--accent', '--accent-text', '--text', '--text-muted', '--danger', '--success', '--bg']
    .map((name) => vars[name])
    .filter((c): c is string => typeof c === 'string' && parseHex(c) !== null)
    .map((c) => toHex(parseHex(c) as [number, number, number]));
  return [...new Set([...colors, ...BASE_COLORS])];
}

/**
 * Окно «Нарисовать свой»: сетка 24×24, кисть, ластик, заливка, палитра (цвета темы и свой цвет), отмена и повтор,
 * «Очистить», предпросмотр на полосе в реальном размере и имя. Пустой рисунок не сохраняется.
 */
export function ThumbEditor({ initial, defaultName, onSave, onClose }: Props) {
  const theme = useSettings((s) => s.settings.theme);
  const titleId = useId();
  const nameId = useId();
  const [pixels, setPixels] = useState(initial?.pixels ?? emptyPixels());
  const [palette, setPalette] = useState<string[]>(() => {
    const base = themeColors(theme.accent, theme.background);
    const mine = initial?.palette ?? [];
    return [...mine, ...base.filter((c) => !mine.includes(c))].slice(0, MAX_THUMB_COLORS);
  });
  const [colorIndex, setColorIndex] = useState(0);
  const [tool, setTool] = useState<Tool>('brush');
  const [name, setName] = useState(initial?.name ?? defaultName);
  const [history, setHistory] = useState<ThumbHistory>(EMPTY_THUMB_HISTORY);
  const [error, setError] = useState<string | null>(null);
  const [previewAt, setPreviewAt] = useState(40);

  // Рисование идёт по ссылке на текущий рисунок: события указателя чаще, чем React успевает обновить состояние.
  // `before` — рисунок до мазка: в историю он попадает одним шагом, когда мазок закончен.
  const pixelsRef = useRef(pixels);
  const stroke = useRef<{ last: number; char: string; before: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  // История лежит в ссылке (читается сразу, без ожидания React); состояние только перерисовывает кнопки.
  const historyRef = useRef(history);

  const commit = useCallback((next: string) => {
    pixelsRef.current = next;
    setPixels(next);
    setError(null);
  }, []);

  const setHistoryNow = useCallback((next: ThumbHistory) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  /** Шаг истории: `before` — рисунок до действия. */
  const remember = useCallback(
    (before: string) => setHistoryNow(push(historyRef.current, before)),
    [setHistoryNow],
  );

  const undo = useCallback(() => {
    const step = undoStep(historyRef.current, pixelsRef.current);
    if (!step) return;
    setHistoryNow(step.history);
    commit(step.pixels);
  }, [commit, setHistoryNow]);

  const redo = useCallback(() => {
    const step = redoStep(historyRef.current, pixelsRef.current);
    if (!step) return;
    setHistoryNow(step.history);
    commit(step.pixels);
  }, [commit, setHistoryNow]);

  const clear = () => {
    const before = pixelsRef.current;
    if (isEmptyThumb({ pixels: before })) return;
    remember(before);
    commit(emptyPixels());
  };

  // Холст: клетки палитры поверх шахматки (она — фон стиля) и тонкая сетка.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < CELLS; i++) {
      const ch = pixels[i];
      if (ch === '.') continue;
      ctx.fillStyle = palette[COLOR_CHARS.indexOf(ch)] ?? 'transparent';
      ctx.fillRect((i % THUMB_GRID) * CELL_PX, Math.floor(i / THUMB_GRID) * CELL_PX, CELL_PX, CELL_PX);
    }
    const fg = getComputedStyle(canvas).getPropertyValue('--fg-rgb').trim() || '255, 255, 255';
    ctx.strokeStyle = `rgba(${fg}, 0.14)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < THUMB_GRID; k++) {
      ctx.moveTo(k * CELL_PX + 0.5, 0);
      ctx.lineTo(k * CELL_PX + 0.5, canvas.height);
      ctx.moveTo(0, k * CELL_PX + 0.5);
      ctx.lineTo(canvas.width, k * CELL_PX + 0.5);
    }
    ctx.stroke();
  }, [pixels, palette]);

  const cellAt = (e: PointerEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(THUMB_GRID - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * THUMB_GRID)));
    const y = Math.min(THUMB_GRID - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * THUMB_GRID)));
    return y * THUMB_GRID + x;
  };

  const paint = (cells: number[], char: string) => {
    let next = pixelsRef.current;
    for (const cell of cells) next = setPixel(next, cell, char);
    if (next !== pixelsRef.current) commit(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const cell = cellAt(e);
    const char = tool === 'eraser' ? '.' : COLOR_CHARS[colorIndex];
    if (tool === 'fill') {
      const next = floodFill(pixelsRef.current, cell, char);
      if (next !== pixelsRef.current) {
        remember(pixelsRef.current);
        commit(next);
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = { last: cell, char, before: pixelsRef.current };
    paint([cell], char);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = stroke.current;
    if (!s) return;
    const cell = cellAt(e);
    if (cell === s.last) return;
    paint(cellsBetween(s.last, cell), s.char);
    s.last = cell;
  };

  const endStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = stroke.current;
    stroke.current = null;
    // Мазок, который ничего не изменил (тот же цвет, стёрли пустое), шагом не считается.
    if (s && pixelsRef.current !== s.before) remember(s.before);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Свой цвет: событие `change` у нативного выбора приходит, когда цвет выбран, а не пока его тянут.
  useEffect(() => {
    const input = colorRef.current;
    if (!input) return;
    const onChange = () => {
      const rgb = parseHex(input.value);
      if (!rgb) return;
      const hex = toHex(rgb);
      setPalette((p) => {
        const at = p.indexOf(hex);
        if (at >= 0) {
          setColorIndex(at);
          return p;
        }
        if (p.length >= MAX_THUMB_COLORS) return p;
        setColorIndex(p.length);
        return [...p, hex];
      });
      setTool((t) => (t === 'eraser' ? 'brush' : t));
    };
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, []);

  const save = () => {
    if (isEmptyThumb({ pixels })) {
      setError('Нарисуй хоть что-нибудь');
      return;
    }
    const compact = compactThumb(palette, pixels);
    onSave({ name: name.trim().slice(0, MAX_THUMB_NAME) || defaultName, ...compact });
  };

  // Esc закрывает окно (и не уходит дальше, как в `ConfirmDialog`); Ctrl+Z / Ctrl+Y — отмена и повтор.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, undo, redo]);

  const draft = useMemo<CustomThumb[]>(() => [{ id: 'draft', name: '', ...compactThumb(palette, pixels) }], [palette, pixels]);
  const full = palette.length >= MAX_THUMB_COLORS;

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.dialog}>
        <h3 id={titleId}>{initial ? 'Изменить значок' : 'Нарисовать свой значок'}</h3>
        <div className={styles.body}>
          <div className={styles.canvasBox}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              width={THUMB_GRID * CELL_PX}
              height={THUMB_GRID * CELL_PX}
              role="img"
              aria-label="Поле рисования 24 на 24 клетки"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
            />
          </div>

          <div className={styles.side}>
            <div className={styles.row} role="radiogroup" aria-label="Инструмент">
              {TOOLS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={tool === id}
                  className={[styles.tool, tool === id ? styles.on : ''].filter(Boolean).join(' ')}
                  title={label}
                  onClick={() => setTool(id)}
                >
                  <Icon size={17} strokeWidth={2.2} />
                  {label}
                </button>
              ))}
            </div>

            <div className={styles.row}>
              <button type="button" className={styles.small} title="Отменить (Ctrl+Z)" disabled={history.past.length === 0} onClick={undo}>
                <Undo2 size={16} strokeWidth={2.2} />
                Отмена
              </button>
              <button type="button" className={styles.small} title="Повторить (Ctrl+Y)" disabled={history.future.length === 0} onClick={redo}>
                <Redo2 size={16} strokeWidth={2.2} />
                Повтор
              </button>
              <button type="button" className={styles.small} title="Стереть всё" disabled={isEmptyThumb({ pixels })} onClick={clear}>
                <Trash2 size={16} strokeWidth={2.2} />
                Очистить
              </button>
            </div>

            <div className={styles.group}>
              <span className={styles.label}>Цвет</span>
              <div className={styles.palette} role="radiogroup" aria-label="Цвет кисти">
                {palette.map((color, i) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={colorIndex === i && tool !== 'eraser'}
                    aria-label={color}
                    title={color}
                    className={[styles.swatch, colorIndex === i && tool !== 'eraser' ? styles.on : ''].filter(Boolean).join(' ')}
                    style={{ background: color }}
                    onClick={() => {
                      setColorIndex(i);
                      if (tool === 'eraser') setTool('brush');
                    }}
                  />
                ))}
                <label className={[styles.swatch, styles.add, full ? styles.disabled : ''].filter(Boolean).join(' ')} title={full ? 'В палитре уже 16 цветов' : 'Свой цвет'}>
                  <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
                  <input ref={colorRef} type="color" aria-label="Свой цвет" disabled={full} />
                </label>
              </div>
            </div>

            <div className={styles.group}>
              <span className={styles.label}>На полосе трека — в реальном размере</span>
              <div className={styles.preview}>
                <ThumbRange
                  fill={previewAt}
                  choice={isEmptyThumb({ pixels }) ? DEFAULT_THUMB_CHOICE : { kind: 'custom', id: 'draft' }}
                  customs={draft}
                  min={0}
                  max={100}
                  step={1}
                  value={previewAt}
                  aria-label="Предпросмотр значка на полосе"
                  onChange={(e) => setPreviewAt(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.group}>
              <label htmlFor={nameId} className={styles.label}>
                Название
              </label>
              <input
                id={nameId}
                className={styles.name}
                value={name}
                maxLength={MAX_THUMB_NAME}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <p className={styles.error} role="alert">
            {error}
          </p>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save}>Сохранить</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
