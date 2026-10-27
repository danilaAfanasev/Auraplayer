import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { flushPendingSaves } from '../../stores/persist';
import styles from './TitleBar.module.css';

/** Своя верхняя полоса окна: перетаскивание и кнопки свернуть / развернуть / закрыть. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => window.aura.window.onMaximized(setMaximized), []);

  const close = async () => {
    // Дописываем отложенные сохранения перед закрытием.
    await Promise.race([flushPendingSaves(), new Promise((r) => setTimeout(r, 1500))]);
    window.aura.window.close();
  };

  return (
    // Двойной клик по полосе разворачивает окно силами Windows (область перетаскивания).
    <div className={maximized ? [styles.bar, styles.maximized].join(' ') : styles.bar}>
      <div className={styles.controls}>
        <button type="button" className={styles.control} aria-label="Свернуть" title="Свернуть" onClick={() => window.aura.window.minimize()}>
          <Minus size={16} />
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label={maximized ? 'Восстановить' : 'Развернуть'}
          title={maximized ? 'Восстановить' : 'Развернуть'}
          onClick={() => window.aura.window.toggleMaximize()}
        >
          {maximized ? <Copy size={13} className={styles.restore} /> : <Square size={13} />}
        </button>
        <button type="button" className={[styles.control, styles.close].join(' ')} aria-label="Закрыть" title="Закрыть" onClick={() => void close()}>
          <X size={17} />
        </button>
      </div>
    </div>
  );
}
