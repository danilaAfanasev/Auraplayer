import { AudioWaveform } from 'lucide-react';
import { useId } from 'react';
import { CHART_COUNTRIES, type Settings } from '../../../shared/types';
import { useSettings } from '../../stores/useSettings';
import { SettingsSection } from './SettingsSection';
import own from './PlaybackSection.module.css';
import styles from './YoutubeSection.module.css';

/**
 * Секция «Воспроизведение»: «Похожие после конца списка» — доиграл обычный список (поиск, артист, плейлист, чарт)
 * при выключенном повторе — дальше сама включается волна похожих на последний трек.
 * «Страна чарта» — чарт «Популярное сейчас» и поиск каталога (по умолчанию — страна системы).
 */
export function PlaybackSection() {
  const titleId = useId();
  const enabled = useSettings((s) => s.settings.waveAfterQueue);
  const update = useSettings((s) => s.update);
  const country = useSettings((s) => s.settings.chartCountry);
  const countryId = useId();

  return (
    <SettingsSection
      id="playback"
      icon={AudioWaveform}
      title="Воспроизведение"
      description="Что играет, когда список доиграл до конца, и из какой страны чарт."
    >
      <label className={styles.toggleRow}>
        <span className={styles.toggleText}>
          <span id={titleId} className={styles.toggleTitle}>
            Похожие после конца списка
          </span>
          <span className={styles.toggleSub}>
            {enabled
              ? 'Список доиграл, а повтор выключен — дальше волна похожих на последний трек'
              : 'Выключено: в конце списка плеер останавливается'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={titleId}
          className={styles.switch}
          onClick={(e) => {
            e.preventDefault();
            update({ waveAfterQueue: !enabled });
          }}
        />
      </label>

      <div className={own.selectRow}>
        <label htmlFor={countryId} className={own.selectText}>
          <span className={own.selectTitle}>Страна чарта</span>
          <span className={own.selectSub}>«Популярное сейчас» и поиск по каталогу</span>
        </label>
        <select
          id={countryId}
          className={own.select}
          value={country}
          onChange={(e) => update({ chartCountry: e.target.value as Settings['chartCountry'] })}
        >
          <option value="auto">Как в системе</option>
          {CHART_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </SettingsSection>
  );
}
