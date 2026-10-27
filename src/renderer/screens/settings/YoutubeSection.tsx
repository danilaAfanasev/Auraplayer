import { Info, Loader2, RefreshCw, TvMinimalPlay } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { YtDlpStatus } from '../../../shared/api';
import { errorMessage } from '../../app/errors';
import { Button } from '../../components/Button/Button';
import { useSettings } from '../../stores/useSettings';
import { useYtDlpProgress, ytDlpProgressText } from '../search/ytdlpProgress';
import { SettingsSection } from './SettingsSection';
import form from './settingsForm.module.css';
import { StatusLine, type StatusResult } from './StatusLine';
import styles from './YoutubeSection.module.css';

type UpdateState = { status: 'idle' } | { status: 'updating' } | ({ status: 'result' } & StatusResult);

/**
 * Секция «YouTube»: переключатель источника (только анонимно — входа в аккаунт нет и не будет),
 * версия yt-dlp и «Обновить yt-dlp»; подсказка про сеть — только если скачать yt-dlp не удалось.
 */
export function YoutubeSection() {
  const titleId = useId();
  const enabled = useSettings((s) => s.settings.youtubeEnabled);
  const update = useSettings((s) => s.update);
  const [status, setStatus] = useState<YtDlpStatus | null>(null);
  const [upd, setUpd] = useState<UpdateState>({ status: 'idle' });
  const progress = useYtDlpProgress();

  const refreshStatus = async (): Promise<YtDlpStatus | null> => {
    try {
      const s = await window.aura.ytdlp.status();
      setStatus(s);
      return s;
    } catch {
      setStatus({ installed: false, version: null });
      return null;
    }
  };

  // При открытии и когда закончилась установка (например, при первом поиске) — свежая версия.
  const idle = progress === null;
  useEffect(() => {
    if (idle) void refreshStatus();
  }, [idle]);

  const retryInstall = async (): Promise<void> => {
    setStatus((s) => (s ? { ...s, install: 'running' } : s));
    try {
      await window.aura.ytdlp.install();
    } catch {
      // ошибка уже показана полоской в сайдбаре
    }
    void refreshStatus();
  };

  const runUpdate = async (): Promise<void> => {
    setUpd({ status: 'updating' });
    const before = status?.installed ? status.version : null;
    try {
      const { version } = await window.aura.ytdlp.update();
      setStatus({ installed: true, version });
      if (before && before === version) setUpd({ status: 'result', tone: 'neutral', text: `Уже последняя версия — ${version}` });
      else setUpd({ status: 'result', tone: 'ok', text: before ? `Обновлено до ${version}` : `Установлен yt-dlp ${version}` });
    } catch (err) {
      setUpd({ status: 'result', tone: 'bad', text: errorMessage(err, 'Не удалось обновить yt-dlp — попробуй позже') });
    }
  };

  const updating = upd.status === 'updating';
  const busyText = progress ? ytDlpProgressText(progress) : 'Проверяю обновления…';

  return (
    <SettingsSection
      id="youtube"
      icon={TvMinimalPlay}
      title="YouTube"
      description="Поиск и звук с YouTube через yt-dlp — анонимно: без входа в аккаунт и без куки браузера."
    >
      <label className={styles.toggleRow}>
        <span className={styles.toggleText}>
          <span id={titleId} className={styles.toggleTitle}>
            YouTube (без входа в аккаунт)
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
            update({ youtubeEnabled: !enabled });
          }}
        />
      </label>

      <div className={[form.field, form.narrow, styles.spaced].join(' ')}>
        <span className={form.label}>yt-dlp — программа, через которую Aura получает звук с YouTube и SoundCloud</span>
        <div className={form.row}>
          <div className={styles.version}>
            {status === null ? (
              'Проверяю…'
            ) : status.installed ? (
              <span>
                Версия <strong>{status.version ?? 'неизвестна'}</strong>
              </span>
            ) : (
              status.install === 'running' ? 'Скачивается…' : 'Ещё не загружен — скачается при запуске, если есть интернет'
            )}
          </div>
          <Button variant="outline" disabled={updating} onClick={() => void runUpdate()}>
            {updating ? <Loader2 size={17} strokeWidth={2.2} className="spin" /> : <RefreshCw size={17} strokeWidth={2.2} />}
            {updating ? 'Обновляю…' : 'Обновить yt-dlp'}
          </Button>
        </div>
        <StatusLine result={updating ? { tone: 'neutral', text: busyText } : upd.status === 'result' ? upd : null} />
      </div>

      {status?.install === 'failed' && (
        <>
          <p className={[form.hint, form.narrow, styles.note].join(' ')}>
            <Info size={15} />
            Не удалось скачать yt-dlp. Проверь интернет (если сайты заблокированы, поможет VPN). «Мои файлы» работают и без него.
          </p>
          <div className={[form.row, form.narrow].join(' ')}>
            <Button variant="outline" onClick={() => void retryInstall()}>
              Повторить
            </Button>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
