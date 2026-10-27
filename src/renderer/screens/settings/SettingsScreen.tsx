import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { AppearanceSection } from './AppearanceSection';
import { BlacklistSection } from './BlacklistSection';
import { DownloadSection } from './DownloadSection';
import { LocalFoldersSection } from './LocalFoldersSection';
import { PlaybackSection } from './PlaybackSection';
import styles from './SettingsScreen.module.css';
import { SoundcloudSection } from './SoundcloudSection';
import { YoutubeSection } from './YoutubeSection';

/**
 * Экран настроек: колонка стеклянных секций (`SettingsSection`).
 * Порядок секций: Оформление → Воспроизведение → Чёрный список → Скачивание → Мои файлы → YouTube → SoundCloud.
 */
export function SettingsScreen() {
  return (
    <>
      <ScreenHeader eyebrow="Aura" title="Настройки" />
      <div className={styles.sections}>
        <AppearanceSection />
        <PlaybackSection />
        <BlacklistSection />
        <DownloadSection />
        <LocalFoldersSection />
        <YoutubeSection />
        <SoundcloudSection />
      </div>
    </>
  );
}
