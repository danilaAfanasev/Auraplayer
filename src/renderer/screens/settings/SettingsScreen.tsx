import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { BlacklistSection } from './BlacklistSection';
import { DownloadSection } from './DownloadSection';
import { EqualizerSection } from './EqualizerSection';
import { LocalFoldersSection } from './LocalFoldersSection';
import { PlaybackSection } from './PlaybackSection';
import styles from './SettingsScreen.module.css';
import { SoundcloudSection } from './SoundcloudSection';
import { ThumbSection } from './ThumbSection';
import { YoutubeSection } from './YoutubeSection';

/**
 * Экран настроек: колонка стеклянных секций (`SettingsSection`).
 * Порядок секций: Оформление → Ползунок → Воспроизведение → Эквалайзер → Чёрный список → Скачивание → Мои файлы → YouTube → SoundCloud → О программе.
 */
export function SettingsScreen() {
  return (
    <>
      <ScreenHeader eyebrow="Aura" title="Настройки" />
      <div className={styles.sections}>
        <AppearanceSection />
        <ThumbSection />
        <PlaybackSection />
        <EqualizerSection />
        <BlacklistSection />
        <DownloadSection />
        <LocalFoldersSection />
        <YoutubeSection />
        <SoundcloudSection />
        <AboutSection />
      </div>
    </>
  );
}
