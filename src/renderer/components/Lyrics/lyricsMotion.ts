// Анимация открытия и закрытия экрана текста (макет `LyricsOpen`, вариант «круг»): слой раскрывается кругом из
// кнопки «Текст», обложка вылетает из панели плеера на своё место, строки въезжают снизу по очереди; закрытие —
// обратно, слой исчезает в кнопку. «Уменьшить движение» — простое затухание. Всё — Web Animations: длительности
// задаются здесь, глобальное правило «уменьшить движение» для CSS-переходов их не трогает.
import { revealRadius } from '../../theme/colorMath';
import { PLAYER_BAR_ATTR } from '../PlayerBar/PlayerBar';
import { LYRICS_BUTTON_ATTR } from './LyricsButton';

export const LYRICS_OPEN_MS = 480;
export const LYRICS_CLOSE_MS = 400;
export const LYRICS_FADE_MS = 200;
/**
 * Самое позднее, когда открытие или закрытие считается законченным, даже если анимации стоят: в свёрнутом окне
 * кадров нет и `finished` не наступает — слой всё равно доходит до конца (таймеры идут и в скрытом окне).
 */
export const LYRICS_SETTLE_MS = 1000;
const COVER_MS = 500;
const LINE_MS = 420;
const LINE_DELAY_MS = 120;
const LINE_STAGGER_MS = 40;
/** Сколько видимых строк въезжает (все, что помещаются в окно); по очереди — первые `STAGGERED`, остальные — с последней. */
const MAX_ENTERING = 40;
const STAGGERED = 12;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_CIRCLE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** Элементы, которые въезжают снизу по очереди (строки текста, абзацы, надпись «Текста нет»). */
export const ENTER_ATTR = 'data-enter';
/** Элементы левой колонки под обложкой: название, прогресс, кнопки — проявляются следом за обложкой. */
export const ENTER_SIDE_ATTR = 'data-enter-side';

export interface Point {
  x: number;
  y: number;
}

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const circle = (r: number, p: Point): string => `circle(${Math.max(0, r)}px at ${p.x}px ${p.y}px)`;
const windowCenter = (): Point => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
const fullRadius = (p: Point): number => revealRadius(p.x, p.y, window.innerWidth, window.innerHeight);

/** Радиус круга слоя сейчас (посреди анимации); `null` — круга нет (слой открыт целиком). */
export function currentClipRadius(el: HTMLElement): number | null {
  const m = /circle\(\s*([\d.]+)px/.exec(getComputedStyle(el).clipPath);
  return m ? Number(m[1]) : null;
}

/** Центр кнопки «Текст» в панели плеера, если она на месте. */
export function lyricsButtonCenter(): Point | null {
  const r = document.querySelector(`[${LYRICS_BUTTON_ATTR}]`)?.getBoundingClientRect();
  return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

/** Обложка в панели плеера (откуда вылетает и куда возвращается обложка слоя). */
function playerCoverRect(): DOMRect | null {
  const bar = document.querySelector(`[${PLAYER_BAR_ATTR}]`);
  const img = bar?.querySelector('img');
  const r = (img ?? bar)?.getBoundingClientRect();
  if (!r || r.width === 0) return null;
  // Без картинки — квадрат у левого края панели (там стоит заглушка обложки).
  return img ? r : new DOMRect(r.left + 16, r.top + 12, 64, 64);
}

/** Сдвиг и масштаб, которыми обложка слоя совпадает с обложкой панели плеера (FLIP), — или условный «снизу слева». */
function coverFrom(cover: HTMLElement): string {
  const dst = cover.getBoundingClientRect();
  const src = playerCoverRect();
  if (!src || dst.width === 0) return 'translate(-60px, 260px) scale(0.3)';
  return `translate(${src.left - dst.left}px, ${src.top - dst.top}px) scale(${src.width / dst.width})`;
}

/** Видимые в окне текста элементы для въезда, сверху вниз. */
function enterTargets(root: HTMLElement): HTMLElement[] {
  const h = window.innerHeight;
  return [...root.querySelectorAll<HTMLElement>(`[${ENTER_ATTR}]`)]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.height > 0 && r.bottom > 0 && r.top < h)
    .sort((a, b) => a.r.top - b.r.top)
    .slice(0, MAX_ENTERING)
    .map(({ el }) => el);
}

const sideTargets = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`[${ENTER_SIDE_ATTR}]`)];

/**
 * Открытие: круг от `origin` (центр кнопки «Текст») до дальнего угла окна; `fromRadius` — если слой как раз
 * сворачивался, круг растёт с того места. Обложка вылетает из панели плеера, подписи под ней проявляются следом.
 * Строки — отдельно (`linesEnter`), когда текст уже прокручен к текущей строке.
 */
export function openAnimations(root: HTMLElement, cover: HTMLElement | null, origin: Point | null, fromRadius: number): Animation[] {
  if (prefersReducedMotion()) {
    return [root.animate({ opacity: [0, 1] }, { duration: LYRICS_FADE_MS, easing: 'ease' })];
  }
  const p = origin ?? windowCenter();
  const anims = [
    root.animate({ clipPath: [circle(fromRadius, p), circle(fullRadius(p), p)] }, { duration: LYRICS_OPEN_MS, easing: EASE_CIRCLE }),
  ];
  if (cover && fromRadius === 0) {
    anims.push(
      cover.animate(
        [
          { transform: coverFrom(cover), transformOrigin: '0 0', opacity: 0.4 },
          { transform: 'none', transformOrigin: '0 0', opacity: 1 },
        ],
        { duration: COVER_MS, easing: EASE_OUT },
      ),
    );
  }
  sideTargets(root).forEach((el, i) => {
    anims.push(
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], {
        duration: LINE_MS,
        delay: 160 + i * LINE_STAGGER_MS,
        easing: EASE_OUT,
        fill: 'backwards',
      }),
    );
  });
  return anims;
}

/** Строки въезжают снизу по очереди (видимые сверху вниз). */
export function linesEnter(root: HTMLElement): Animation[] {
  if (prefersReducedMotion()) return [];
  return enterTargets(root).map((el, i) =>
    el.animate([{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], {
      duration: LINE_MS,
      delay: LINE_DELAY_MS + Math.min(i, STAGGERED) * LINE_STAGGER_MS,
      easing: EASE_OUT,
      fill: 'backwards',
    }),
  );
}

/**
 * Закрытие — обратное: строки и подписи уходят вниз и гаснут, обложка возвращается в панель плеера, круг
 * сжимается в кнопку «Текст» (`origin`; её нет — в точку открытия или центр окна). `fromRadius` — круг посреди
 * открытия; `null` — слой был открыт целиком. Всё остаётся в конечном состоянии до размонтирования слоя.
 */
export function closeAnimations(root: HTMLElement, cover: HTMLElement | null, origin: Point | null, fromRadius: number | null): Animation[] {
  if (prefersReducedMotion()) {
    return [root.animate({ opacity: [1, 0] }, { duration: LYRICS_FADE_MS, easing: 'ease', fill: 'forwards' })];
  }
  const p = origin ?? windowCenter();
  const anims = [
    root.animate({ clipPath: [circle(fromRadius ?? fullRadius(p), p), circle(0, p)] }, {
      duration: LYRICS_CLOSE_MS,
      easing: EASE_CIRCLE,
      fill: 'forwards',
    }),
  ];
  if (cover) {
    anims.push(
      cover.animate(
        [
          { transform: 'none', transformOrigin: '0 0', opacity: 1 },
          { transform: coverFrom(cover), transformOrigin: '0 0', opacity: 0.4 },
        ],
        { duration: LYRICS_CLOSE_MS, easing: EASE_CIRCLE, fill: 'forwards' },
      ),
    );
  }
  for (const el of [...enterTargets(root), ...sideTargets(root)]) {
    anims.push(
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(20px)' }], {
        duration: LYRICS_FADE_MS,
        easing: 'ease-in',
        fill: 'forwards',
      }),
    );
  }
  return anims;
}
