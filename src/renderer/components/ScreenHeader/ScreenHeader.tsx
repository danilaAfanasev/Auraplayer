import type { ReactNode } from 'react';
import styles from './ScreenHeader.module.css';

interface Props {
  /** Маленькая приглушённая подпись над заголовком. */
  eyebrow?: string;
  title: string;
  /** Справа от заголовка: ссылки «Все», кнопки. */
  aside?: ReactNode;
}

/** Крупный жирный заголовок экрана с приглушённой подписью. */
export function ScreenHeader({ eyebrow, title, aside }: Props) {
  return (
    <header className={styles.header}>
      <div>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {aside && <div className={styles.aside}>{aside}</div>}
    </header>
  );
}
