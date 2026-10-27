import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../Button/Button';
import styles from './ConfirmDialog.module.css';

interface Props {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

/** Подтверждение необратимого действия: фокус на «Отмена», Esc и клик по затемнению отменяют. */
export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onCancel }: Props) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className={styles.dialog}>
        <h3 id={titleId}>{title}</h3>
        <p>{text}</p>
        <div className={styles.actions}>
          <Button autoFocus variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button className={styles.danger} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
