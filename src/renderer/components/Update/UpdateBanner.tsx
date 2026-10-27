import { CircleAlert, Download, LoaderCircle, RotateCw, Sparkles, X } from 'lucide-react';
import { useUpdate, useUpdateBannerShown } from '../../stores/useUpdate';
import styles from './Update.module.css';
import { UpdateProgress } from './UpdateProgress';

/**
 * Плашка над содержимым после «Позже» (G49): «Вышла версия X.Y.Z» + «Обновить» (скачивание с ходом прямо в плашке)
 * + крестик — прячет до следующего запуска. Стоит под заголовком окна и не перекрывает его кнопки и перетаскивание.
 */
export function UpdateBanner() {
  const shown = useUpdateBannerShown();
  const { phase, info, progress, error } = useUpdate();
  const update = useUpdate((s) => s.update);
  const later = useUpdate((s) => s.later);
  const hideBanner = useUpdate((s) => s.hideBanner);
  if (!shown || !info) return null;

  let content;
  if (phase === 'downloading') {
    content = (
      <>
        <UpdateProgress progress={progress} compact />
        <button type="button" className={styles.bannerAction} onClick={later}>
          Отмена
        </button>
      </>
    );
  } else if (phase === 'installing') {
    content = (
      <span className={styles.bannerText} role="status">
        <LoaderCircle size={15} className="spin" />
        Устанавливаю…
      </span>
    );
  } else if (phase === 'failed') {
    content = (
      <>
        <span className={styles.bannerText} role="alert" title={error ?? undefined}>
          <CircleAlert size={15} className={styles.bannerDanger} />
          Не удалось скачать обновление
        </span>
        <button type="button" className={styles.bannerAction} onClick={() => void update()}>
          <RotateCw size={14} strokeWidth={2.4} />
          Повторить
        </button>
      </>
    );
  } else {
    content = (
      <>
        <span className={styles.bannerText}>
          <Sparkles size={15} className={styles.bannerIcon} />
          Вышла версия {info.version}
        </span>
        <button type="button" className={styles.bannerAction} onClick={() => void update()}>
          <Download size={14} strokeWidth={2.4} />
          Обновить
        </button>
      </>
    );
  }

  return (
    <div className={styles.banner} aria-label="Обновление Aura">
      {content}
      {phase !== 'installing' && phase !== 'downloading' && (
        <button type="button" className={styles.bannerClose} aria-label="Скрыть до следующего запуска" title="Скрыть до следующего запуска" onClick={hideBanner}>
          <X size={15} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
