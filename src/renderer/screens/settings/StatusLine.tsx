import { CheckCircle2, XCircle } from 'lucide-react';
import form from './settingsForm.module.css';

/** Итог действия в секции настроек: удача, ошибка или нейтральное пояснение. */
export interface StatusResult {
  tone: 'ok' | 'bad' | 'neutral';
  text: string;
}

/** Строка результата под полем настроек (проверка ключа, обновление yt-dlp): ✓ / ✕ и текст. */
export function StatusLine({ result }: { result: StatusResult | null }) {
  return (
    <div className={form.status} aria-live="polite">
      {result && (
        <span className={[form.result, form[result.tone]].join(' ')}>
          {result.tone === 'ok' && <CheckCircle2 size={16} strokeWidth={2.4} />}
          {result.tone === 'bad' && <XCircle size={16} strokeWidth={2.4} />}
          {result.text}
        </span>
      )}
    </div>
  );
}
