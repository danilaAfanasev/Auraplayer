import { ExternalLink, Info, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RELEASES_PAGE_URL } from '../../../shared/version';
import { Button } from '../../components/Button/Button';
import { checkForUpdatesNow } from '../../stores/useUpdate';
import { SettingsSection } from './SettingsSection';
import form from './settingsForm.module.css';
import { StatusLine, type StatusResult } from './StatusLine';

/**
 * Секция «О программе» (A20, последняя): версия Aura, «Проверить обновления» — «У тебя последняя версия» /
 * окно обновления / «Не удалось проверить — нет соединения», ссылка на страницу релизов.
 */
export function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);

  useEffect(() => {
    let alive = true;
    window.aura.update
      .version()
      .then((v) => alive && setVersion(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const check = async (): Promise<void> => {
    setChecking(true);
    setResult(null);
    const res = await checkForUpdatesNow();
    setChecking(false);
    if (res.kind === 'none') setResult({ tone: 'ok', text: 'У тебя последняя версия' });
    else if (res.kind === 'available') setResult({ tone: 'neutral', text: `Вышла Aura ${res.info.version}` });
    else setResult({ tone: 'bad', text: res.offline ? 'Не удалось проверить — нет соединения' : 'Не удалось проверить — попробуй позже' });
  };

  return (
    <SettingsSection id="about" icon={Info} title="О программе" description="Новая версия приходит сама: при запуске Aura спрашивает, обновиться ли.">
      <div className={[form.field, form.narrow].join(' ')}>
        <span className={form.label}>Версия</span>
        <div className={form.row}>
          <strong>Aura {version ?? '…'}</strong>
          <Button variant="outline" disabled={checking} onClick={() => void check()}>
            {checking ? <Loader2 size={17} strokeWidth={2.2} className="spin" /> : <RefreshCw size={17} strokeWidth={2.2} />}
            {checking ? 'Проверяю…' : 'Проверить обновления'}
          </Button>
          <Button variant="ghost" icon={ExternalLink} onClick={() => void window.aura.openExternal(RELEASES_PAGE_URL).catch(() => undefined)}>
            Все версии
          </Button>
        </div>
        <StatusLine result={checking ? { tone: 'neutral', text: 'Проверяю обновления…' } : result} />
      </div>
    </SettingsSection>
  );
}
