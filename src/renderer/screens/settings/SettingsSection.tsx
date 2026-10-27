import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './SettingsSection.module.css';

interface Props {
  /** Якорь секции (`appearance`, `sources`…): по нему секцию находят и на неё ссылаются. */
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}

/** Стеклянная секция экрана настроек: значок, заголовок, пояснение и содержимое. */
export function SettingsSection({ id, icon: Icon, title, description, children }: Props) {
  return (
    <section id={`settings-${id}`} className={styles.section} aria-labelledby={`settings-${id}-title`}>
      <header className={styles.header}>
        <span className={styles.icon}>
          <Icon size={19} strokeWidth={2.2} />
        </span>
        <div>
          <h2 id={`settings-${id}-title`}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
