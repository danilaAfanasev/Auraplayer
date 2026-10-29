import { useEffect, useMemo, useRef, type CSSProperties, type InputHTMLAttributes } from 'react';
import { thumbArt, type CustomThumb, type ThumbChoice } from '../../../shared/progressThumb';
import { usePlayer } from '../../stores/usePlayer';
import { useSettings } from '../../stores/useSettings';
import styles from './ProgressThumb.module.css';
import { svgUrl } from './thumbUrl';

/** Один оборот пластинки, мс. */
const SPIN_MS = 2600;

let rotationRegistered = false;
/** `--thumb-rot` — угол: зарегистрированное свойство анимируется плавно (у `::-webkit-slider-thumb` своих анимаций нет). */
function registerRotation(): void {
  if (rotationRegistered) return;
  rotationRegistered = true;
  try {
    CSS.registerProperty({ name: '--thumb-rot', syntax: '<angle>', inherits: true, initialValue: '0deg' });
  } catch {
    // уже зарегистрировано или не поддерживается — пластинка просто не крутится
  }
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'style'> {
  /** Сколько полосы закрашено, 0…100 %. */
  fill: number;
  /** Показать не выбранный в настройках значок (предпросмотр). */
  choice?: ThumbChoice;
  customs?: readonly CustomThumb[];
  /** Принудительно крутить пластинку (предпросмотр); иначе она крутится, пока играет трек. */
  spin?: boolean;
}

/**
 * Полоса трека (`<input type="range">`) со значком из настроек вместо кружка: панель плеера, экран текста,
 * предпросмотр в настройках. Громкость сюда не относится — она остаётся обычным ползунком.
 */
export function ThumbRange({ fill, choice, customs, spin, className, ...rest }: Props) {
  const savedChoice = useSettings((s) => s.settings.progressThumb);
  const savedCustoms = useSettings((s) => s.settings.customThumbs);
  const playing = usePlayer((s) => s.isPlaying);
  const art = useMemo(() => thumbArt(choice ?? savedChoice, customs ?? savedCustoms), [choice, customs, savedChoice, savedCustoms]);
  const url = useMemo(() => (art ? svgUrl(art.svg) : null), [art]);
  const spinning = Boolean(art?.spin) && (spin ?? playing);

  const inputRef = useRef<HTMLInputElement>(null);
  const rotation = useRef<Animation | null>(null);
  const canSpin = Boolean(art?.spin);

  // Анимация живёт, пока значок — пластинка; играет/на паузе — следующий эффект (угол на паузе не сбрасывается).
  useEffect(() => {
    const el = inputRef.current;
    if (!canSpin || !el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    registerRotation();
    const anim = el.animate({ '--thumb-rot': ['0deg', '360deg'] }, { duration: SPIN_MS, iterations: Infinity });
    anim.pause();
    rotation.current = anim;
    return () => {
      anim.cancel();
      rotation.current = null;
    };
  }, [canSpin]);

  useEffect(() => {
    const anim = rotation.current;
    if (!anim) return;
    if (spinning) anim.play();
    else anim.pause();
  }, [spinning, canSpin]);

  const style = { '--fill': `${fill}%`, '--p': fill / 100 } as CSSProperties & Record<string, string | number>;
  if (art && url) {
    style['--thumb-url'] = url;
    style['--thumb-size'] = `${art.size}px`;
  }
  return (
    <input
      {...rest}
      ref={inputRef}
      type="range"
      className={[styles.range, className].filter(Boolean).join(' ')}
      data-thumb={art?.mode}
      style={style}
    />
  );
}
