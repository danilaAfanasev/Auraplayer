// Плавная смена темы: заливка расходящимся кругом (View Transitions API), кроссфейд при
// «уменьшении анимации» и запасной путь — плавный переход CSS-переменных.
import { revealRadius } from './colorMath';
import './themeTransition.css';

export const THEME_REVEAL_MS = 700;
export const THEME_FADE_MS = 200;
const SMOOTH_FALLBACK_MS = 350;

export interface ThemeOrigin {
  x: number;
  y: number;
}

const root = (): HTMLElement => document.documentElement;
const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let smoothTimer: ReturnType<typeof setTimeout> | null = null;
/** Номер последней смены темы: устаревший переход не должен сбрасывать классы нового. */
let latest = 0;

/** Без View Transitions: переменные темы плавно перетекают за 350 мс. */
function applySmoothly(apply: () => void): void {
  root().classList.add('theme-smooth');
  apply();
  if (smoothTimer) clearTimeout(smoothTimer);
  smoothTimer = setTimeout(() => root().classList.remove('theme-smooth'), SMOOTH_FALLBACK_MS + 50);
}

/**
 * Выполняет `apply` (он ставит переменные темы) внутри анимированного перехода.
 * Круг растёт от `origin` (по умолчанию — центр окна) до самого дальнего угла за 0,7 с.
 * DOM при этом не пересобирается, аудио не затрагивается. Возвращает промис завершения.
 */
export async function runThemeTransition(apply: () => void, origin?: ThemeOrigin): Promise<void> {
  if (typeof document.startViewTransition !== 'function' || document.hidden) {
    applySmoothly(apply);
    return;
  }

  const mine = ++latest;
  const el = root();
  const reduced = prefersReducedMotion();
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;

  el.style.setProperty('--vt-x', `${x}px`);
  el.style.setProperty('--vt-y', `${y}px`);
  el.classList.add(reduced ? 'vt-fade' : 'vt-reveal');

  const transition = document.startViewTransition(apply);
  const cleanup = (): void => el.classList.remove('vt-fade', 'vt-reveal');

  try {
    await transition.ready;
    if (!reduced) {
      const radius = revealRadius(x, y, window.innerWidth, window.innerHeight);
      // fill: 'forwards' — круг остаётся полным и после конца анимации. Без него анимация (её ведёт композитор)
      // кончалась раньше, чем главный поток снимал снимки перехода, и до снятия действовало правило из CSS —
      // круг нулевого радиуса: на кадр-другой (дольше, если главный поток занят) было видно старую тему.
      el.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: THEME_REVEAL_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards', pseudoElement: '::view-transition-new(root)' },
      );
    }
  } catch {
    // Переход пропущен (например, его вытеснила следующая смена темы) — тема уже применена.
  }
  await transition.finished.catch(() => undefined);
  if (mine === latest) cleanup();
}
