import { Download, FolderOpen, FolderPen } from 'lucide-react';
import { Button } from '../../components/Button/Button';
import { errorMessage } from '../../app/errors';
import { flushSettings, useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { openDownloadDir } from '../downloads/DownloadsScreen';
import styles from './LibrarySections.module.css';
import form from './settingsForm.module.css';
import { SettingsSection } from './SettingsSection';

/** Секция «Скачивание»: папка для скачанных треков — путь, «Изменить…», «Открыть папку». */
export function DownloadSection() {
  const dir = useSettings((s) => s.settings.downloadDir);
  const update = useSettings((s) => s.update);

  const change = async (): Promise<void> => {
    try {
      const picked = await window.aura.pickDownloadDir();
      if (!picked || picked === dir) return;
      update({ downloadDir: picked });
      await flushSettings(); // новые загрузки берут папку из сохранённых настроек
      useUi.getState().toast('Новые скачивания пойдут в выбранную папку');
    } catch (err) {
      useUi.getState().toast(errorMessage(err, 'Не удалось выбрать папку'), undefined, 'error');
    }
  };

  return (
    <SettingsSection
      id="downloads"
      icon={Download}
      title="Скачивание"
      description="Куда сохранять скачанные треки. Уже скачанные файлы остаются на месте."
    >
      <div className={form.field}>
        <span className={form.label}>Папка для скачанной музыки</span>
        <div className={form.row}>
          <div className={styles.path} title={dir}>
            <FolderOpen size={17} strokeWidth={2} />
            <span>{dir || 'Не выбрана'}</span>
          </div>
          <Button variant="outline" icon={FolderPen} onClick={() => void change()}>
            Изменить…
          </Button>
          <Button variant="ghost" icon={FolderOpen} disabled={!dir} onClick={() => openDownloadDir(dir)}>
            Открыть папку
          </Button>
        </div>
        <p className={form.hint}>Имена файлов — «Исполнитель — Название», существующие файлы не перезаписываются.</p>
      </div>
    </SettingsSection>
  );
}
