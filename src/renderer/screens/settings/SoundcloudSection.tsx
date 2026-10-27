import { Cloud, Info } from 'lucide-react';
import { useId } from 'react';
import { useSettings } from '../../stores/useSettings';
import { SettingsSection } from './SettingsSection';
import form from './settingsForm.module.css';
import styles from './YoutubeSection.module.css';

/**
 * Секция «SoundCloud»: переключатель источника. Как и YouTube — через yt-dlp и только анонимно:
 * входа в аккаунт нет и не будет; треки, у которых без входа есть лишь 30-секундный отрывок, не показываются.
 */
export function SoundcloudSection() {
  const titleId = useId();
  const enabled = useSettings((s) => s.settings.soundcloudEnabled);
  const update = useSettings((s) => s.update);

  return (
    <SettingsSection
      id="soundcloud"
      icon={Cloud}
      title="SoundCloud"
      description="Андеграунд, ремиксы и треки, которых нет на площадках, — анонимно, через тот же yt-dlp, что и YouTube."
    >
      <label className={styles.toggleRow}>
        <span className={styles.toggleText}>
          <span id={titleId} className={styles.toggleTitle}>
            SoundCloud (без входа в аккаунт)
          </span>
          <span className={styles.toggleSub}>{enabled ? 'Ищется вместе с остальными источниками' : 'Выключен: не ищется и не показывается'}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={titleId}
          className={styles.switch}
          onClick={(e) => {
            e.preventDefault();
            update({ soundcloudEnabled: !enabled });
          }}
        />
      </label>

      <p className={[form.hint, form.narrow, styles.note].join(' ')}>
        <Info size={15} />
        Треки крупных лейблов SoundCloud без входа отдаёт только 30-секундным отрывком — такие в поиске не показываются.
      </p>
    </SettingsSection>
  );
}
