import { Download, LoaderCircle, RotateCw } from 'lucide-react';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useUpdate } from '../../stores/useUpdate';
import { Button } from '../Button/Button';
import styles from './Update.module.css';
import { UpdateProgress } from './UpdateProgress';

/**
 * Окно-вопрос «Вышла Aura X.Y.Z» (G47–G48): «что нового», «Обновить» / «Позже»; скачивание с прогрессом и «Отмена»,
 * «Устанавливаю…», сбой — «Повторить» / «Позже». Esc и клик мимо — «Позже» (пока ставится — не закрывается).
 */
export function UpdateDialog() {
  const titleId = useId();
  const { phase, info, progress, error, dialogOpen } = useUpdate();
  const later = useUpdate((s) => s.later);
  const update = useUpdate((s) => s.update);
  const open = dialogOpen && info !== null && phase !== 'idle';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        later();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, later]);

  if (!open) return null;

  let body;
  if (phase === 'downloading') {
    body = (
      <>
        <UpdateProgress progress={progress} />
        <div className={styles.actions}>
          <Button variant="outline" autoFocus onClick={later}>
            Отмена
          </Button>
        </div>
      </>
    );
  } else if (phase === 'installing') {
    body = (
      <p className={styles.installing} role="status">
        <LoaderCircle size={18} className="spin" />
        Устанавливаю… Aura закроется и откроется сама
      </p>
    );
  } else if (phase === 'failed') {
    body = (
      <>
        <p className={styles.error} role="alert">
          {error ?? 'Не удалось скачать обновление'}
        </p>
        <div className={styles.actions}>
          <Button variant="outline" onClick={later}>
            Позже
          </Button>
          <Button icon={RotateCw} autoFocus onClick={() => void update()}>
            Повторить
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {info.notes && (
          <div className={styles.notes} tabIndex={0} aria-label="Что нового">
            {info.notes}
          </div>
        )}
        <div className={styles.actions}>
          <Button variant="outline" onClick={later}>
            Позже
          </Button>
          <Button icon={Download} autoFocus onClick={() => void update()}>
            Обновить
          </Button>
        </div>
      </>
    );
  }

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && later()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.dialog}>
        <span className={styles.eyebrow}>Обновление</span>
        <h3 id={titleId}>Вышла Aura {info.version}</h3>
        {body}
      </div>
    </div>,
    document.body,
  );
}
