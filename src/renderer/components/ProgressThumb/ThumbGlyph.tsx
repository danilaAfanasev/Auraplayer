import { useMemo, type CSSProperties } from 'react';
import { thumbArt, type CustomThumb, type ThumbChoice } from '../../../shared/progressThumb';
import styles from './ProgressThumb.module.css';
import { svgUrl } from './thumbUrl';

/** Размер обычного кружка на полосе, px (как в `global.css`). */
const DOT_SIZE = 12;

interface Props {
  choice: ThumbChoice;
  customs: readonly CustomThumb[];
  /** Во сколько раз крупнее, чем на полосе (по умолчанию в натуральную величину). */
  scale?: number;
  /** Пластинка крутится. */
  spin?: boolean;
  className?: string;
}

/** Значок отдельно от полосы: сетка настроек, окно рисования. */
export function ThumbGlyph({ choice, customs, scale = 1, spin = false, className }: Props) {
  const art = useMemo(() => thumbArt(choice, customs), [choice, customs]);
  const url = useMemo(() => (art ? svgUrl(art.svg) : null), [art]);
  const style = { '--glyph-size': `${(art?.size ?? DOT_SIZE) * scale}px` } as CSSProperties & Record<string, string>;
  if (url) style['--thumb-url'] = url;
  return (
    <span
      className={[styles.glyph, className].filter(Boolean).join(' ')}
      data-thumb={art?.mode ?? 'dot'}
      data-spin={art?.spin && spin ? 'on' : undefined}
      style={style}
      aria-hidden="true"
    />
  );
}

/** Рисунок, ещё не сохранённый в настройках (окно рисования), — тем же значком. */
export function DraftGlyph({ thumb, scale, className }: { thumb: Pick<CustomThumb, 'palette' | 'pixels'>; scale?: number; className?: string }) {
  const draft = useMemo<CustomThumb[]>(() => [{ id: 'draft', name: '', ...thumb }], [thumb]);
  return <ThumbGlyph choice={{ kind: 'custom', id: 'draft' }} customs={draft} scale={scale} className={className} />;
}
