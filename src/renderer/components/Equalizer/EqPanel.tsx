import { useId, useState, type FormEvent } from 'react';
import {
  allPresets,
  applyPreset,
  CUSTOM_PRESET_ID,
  CUSTOM_PRESET_NAME,
  nextPresetName,
  presetLabel,
  resetEqualizer,
  savePreset,
  type EqualizerSettings,
  type PresetError,
} from '../../../shared/equalizer';
import { useSettings } from '../../stores/useSettings';
import { EqCurve } from './EqCurve';
import styles from './Equalizer.module.css';

/** Тексты ошибок имени пресета (сохранение и переименование). */
export const PRESET_ERROR_TEXT: Record<PresetError, string> = {
  empty: 'Впиши название',
  duplicate: 'Такой пресет уже есть',
  limit: 'Своих пресетов уже 20 — удали лишний в настройках',
};

/** Состояние эквалайзера и его правка — одно на окошко и раздел настроек. */
export function useEqualizer(): [EqualizerSettings, (next: EqualizerSettings) => void] {
  const eq = useSettings((s) => s.settings.equalizer);
  const update = useSettings((s) => s.update);
  return [eq, (next) => update({ equalizer: next })];
}

/** «Включён · Бас» / «Выключен». */
export function eqStatusText(eq: EqualizerSettings): string {
  return eq.enabled ? `Включён · ${presetLabel(eq)}` : 'Выключен';
}

interface EqPanelProps {
  size: 'popover' | 'large';
  /** Окошко у кнопки: «Все настройки →» ведёт в раздел настроек. */
  onOpenSettings?: () => void;
}

/**
 * Эквалайзер: переключатель с подписью «Включён · Бас», пресеты-кнопки (встроенные, мои, «Свой»),
 * кривая с точками, «Сбросить», «Сохранить как пресет». Общий для окошка у кнопки в панели плеера
 * и раздела «Эквалайзер» в настройках.
 */
export function EqPanel({ size, onOpenSettings }: EqPanelProps) {
  const [eq, setEq] = useEqualizer();
  const titleId = useId();
  const nameId = useId();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<PresetError | null>(null);

  const startSaving = (): void => {
    setName(nextPresetName(eq));
    setError(null);
    setSaving(true);
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const r = savePreset(eq, name);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setEq(r.eq);
    setSaving(false);
  };

  const presets = allPresets(eq);
  const popover = size === 'popover';

  return (
    <div className={[styles.panel, popover ? styles.panelPopover : styles.panelLarge].join(' ')}>
      <div className={styles.head}>
        <div className={styles.headText}>
          {popover ? (
            <div id={titleId} className={styles.title}>
              Эквалайзер
            </div>
          ) : (
            <div id={titleId} className={styles.title}>
              {eq.enabled ? 'Включён' : 'Выключен'}
            </div>
          )}
          <div className={styles.status}>{popover ? eqStatusText(eq) : eq.enabled ? `Пресет: ${presetLabel(eq)}` : 'Звук как без эквалайзера'}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={eq.enabled}
          aria-label="Эквалайзер"
          className={styles.switch}
          onClick={() => setEq({ ...eq, enabled: !eq.enabled })}
        />
      </div>

      <div className={[styles.presets, eq.enabled ? '' : styles.off].filter(Boolean).join(' ')} role="group" aria-label="Пресеты">
        {presets.map((p) => {
          const active = eq.presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              className={[styles.chip, active ? styles.chipActive : ''].filter(Boolean).join(' ')}
              onClick={() => setEq(applyPreset(eq, p.id))}
            >
              {p.name}
            </button>
          );
        })}
        {eq.presetId === CUSTOM_PRESET_ID && (
          <span className={[styles.chip, styles.chipActive, styles.chipStatic].join(' ')} aria-current="true">
            {CUSTOM_PRESET_NAME}
          </span>
        )}
      </div>

      <EqCurve eq={eq} onChange={setEq} size={size} />
      <div className={styles.hint}>Точки тянутся мышью вверх и вниз, двойной клик — в ноль</div>

      {saving ? (
        <form className={styles.saveForm} onSubmit={submit}>
          <label htmlFor={nameId} className={styles.srOnly}>
            Название пресета
          </label>
          <input
            id={nameId}
            className={styles.nameInput}
            value={name}
            maxLength={40}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.stopPropagation();
              setSaving(false);
            }}
            aria-invalid={error !== null}
          />
          <button type="submit" className={styles.primary}>
            Сохранить
          </button>
          <button type="button" className={styles.ghost} onClick={() => setSaving(false)}>
            Отмена
          </button>
          {error && (
            <div className={styles.error} role="alert">
              {PRESET_ERROR_TEXT[error]}
            </div>
          )}
        </form>
      ) : (
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={() => setEq(resetEqualizer(eq))}>
            Сбросить
          </button>
          <button type="button" className={styles.primary} onClick={startSaving}>
            Сохранить как пресет
          </button>
          {onOpenSettings && (
            <button type="button" className={styles.link} onClick={onOpenSettings}>
              Все настройки →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
