import { FileX } from 'lucide-react';
import styles from './DownloadsScreen.module.css';

/** Отметка «Файл не найден» у трека, файл которого удалили с диска (размер — как у кнопки строки). */
export function MissingBadge() {
  return (
    <span className={styles.missing} role="img" title="Файл не найден — его удалили с диска" aria-label="Файл не найден">
      <FileX size={16} strokeWidth={2.2} />
    </span>
  );
}
