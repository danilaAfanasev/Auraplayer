import { AlertCircle, X } from 'lucide-react';
import { useUi } from '../../stores/useUi';
import styles from './Toast.module.css';

/** Стопка уведомлений над панелью плеера. Вызывать: `useUi.getState().toast(text, action?)`. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={[styles.toast, t.kind === 'error' ? styles.error : ''].join(' ')} role="status">
          {t.kind === 'error' && <AlertCircle size={18} className={styles.icon} />}
          <span className={styles.text}>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className={styles.close} aria-label="Закрыть уведомление" onClick={() => dismiss(t.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
