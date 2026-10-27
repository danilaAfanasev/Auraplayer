import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../Button/Button';
import styles from './EmptyState.module.css';

interface Props {
  icon?: LucideIcon;
  title: string;
  text?: ReactNode;
  action?: { label: string; onClick: () => void; icon?: LucideIcon };
  /** Компактный вариант — для узких блоков (правая колонка). */
  compact?: boolean;
}

/** Пустое состояние: иконка в мягком круге, заголовок, пояснение и необязательная кнопка. */
export function EmptyState({ icon: Icon, title, text, action, compact = false }: Props) {
  return (
    <div className={[styles.empty, compact ? styles.compact : ''].join(' ')}>
      {Icon && (
        <div className={styles.icon}>
          <Icon size={compact ? 20 : 28} strokeWidth={1.8} />
        </div>
      )}
      <h3 className={styles.title}>{title}</h3>
      {text && <p className={styles.text}>{text}</p>}
      {action && (
        <Button variant="outline" icon={action.icon} onClick={action.onClick} className={styles.action}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
