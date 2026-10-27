import { Folder, FolderPlus, HardDrive, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { formatTrackCount } from '../../../shared/format';
import { errorMessage } from '../../app/errors';
import { Button, IconButton } from '../../components/Button/Button';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { useLocalTracks } from '../local/useLocalTracks';
import styles from './LibrarySections.module.css';
import form from './settingsForm.module.css';
import { SettingsSection } from './SettingsSection';

const foundText = (n: number) => `Найдено ${formatTrackCount(n)}`;

/** Одинаковые папки на Windows: регистр и завершающий разделитель не важны. */
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

/**
 * Секция «Мои файлы»: папки с музыкой. «Добавить папку…» — системный диалог; крестик убирает папку
 * только из списка (файлы на диске не трогаются); «Пересканировать» — заново найти треки.
 */
export function LocalFoldersSection() {
  const folders = useSettings((s) => s.settings.localFolders);
  const update = useSettings((s) => s.update);
  const scanning = useLocalTracks((s) => s.scanning);
  const count = useLocalTracks((s) => s.tracks.length);
  const loaded = useLocalTracks((s) => s.loaded);
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    if (!useLocalTracks.getState().loaded) void useLocalTracks.getState().load();
  }, []);

  const rescan = async (announce = true): Promise<void> => {
    const found = await useLocalTracks.getState().rescan();
    if (found !== null && announce) toast(foundText(found));
  };

  const add = async (): Promise<void> => {
    try {
      const picked = await window.aura.local.pickFolder();
      if (!picked) return;
      if (folders.some((f) => samePath(f, picked))) {
        toast('Эта папка уже в списке');
        return;
      }
      update({ localFolders: [...folders, picked] });
      await rescan();
    } catch (err) {
      toast(errorMessage(err, 'Не удалось добавить папку'), undefined, 'error');
    }
  };

  const removeFolder = async (folder: string): Promise<void> => {
    update({ localFolders: folders.filter((f) => f !== folder) });
    toast('Папка убрана из списка — файлы на диске остались');
    await rescan(false);
  };

  return (
    <SettingsSection
      id="local"
      icon={HardDrive}
      title="Мои файлы"
      description="Папки с твоей музыкой: Aura найдёт в них mp3, m4a, flac, ogg, opus и wav, прочитает теги и обложки."
    >
      <div className={form.field}>
        {folders.length > 0 ? (
          <ul className={styles.folders}>
            {folders.map((f) => (
              <li key={f} className={styles.folder}>
                <Folder size={17} strokeWidth={2} />
                <span title={f}>{f}</span>
                <IconButton
                  icon={X}
                  size="small"
                  label="Убрать из списка (файлы останутся на диске)"
                  disabled={scanning}
                  onClick={() => void removeFolder(f)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className={form.hint}>Папок пока нет.</p>
        )}
        <div className={form.row}>
          <Button variant="outline" icon={FolderPlus} disabled={scanning} onClick={() => void add()}>
            Добавить папку…
          </Button>
          <Button variant="ghost" disabled={scanning || folders.length === 0} onClick={() => void rescan()}>
            {scanning ? (
              <LoaderCircle size={17} strokeWidth={2.2} className="spin" />
            ) : (
              <RefreshCw size={17} strokeWidth={2.2} />
            )}
            {scanning ? 'Ищу музыку…' : 'Пересканировать'}
          </Button>
          {loaded && !scanning && folders.length > 0 && <span className={form.hint}>{foundText(count)}</span>}
        </div>
      </div>
    </SettingsSection>
  );
}
