import { SlidersVertical } from 'lucide-react';
import { useId, useState, type CSSProperties, type FormEvent } from 'react';
import {
  applyPreset,
  deletePreset,
  PREAMP_MAX,
  PREAMP_MIN,
  renamePreset,
  restorePreset,
  setPreamp,
  type EqPreset,
  type PresetError,
} from '../../../shared/equalizer';
import { EqPanel, PRESET_ERROR_TEXT, useEqualizer } from '../../components/Equalizer/EqPanel';
import { gainText } from '../../components/Equalizer/eqGeometry';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import styles from './EqualizerSection.module.css';
import { SettingsSection } from './SettingsSection';

/** Строка «Моего пресета»: имя, «Применить», «Переименовать» (поле на месте), «Удалить». */
function PresetRow({ preset, index }: { preset: EqPreset; index: number }) {
  const [eq, setEq] = useEqualizer();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(preset.name);
  const [error, setError] = useState<PresetError | null>(null);
  const inputId = useId();
  const selected = eq.presetId === preset.id;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const r = renamePreset(eq, preset.id, name);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setEq(r.eq);
    setRenaming(false);
  };

  const remove = (): void => {
    setEq(deletePreset(eq, preset.id));
    useUi.getState().toast(`Пресет «${preset.name}» удалён`, {
      label: 'Вернуть',
      run: () => {
        const current = useSettings.getState().settings.equalizer;
        useSettings.getState().update({ equalizer: restorePreset(current, preset, index) });
      },
    });
  };

  if (renaming) {
    return (
      <form className={styles.row} onSubmit={submit}>
        <label htmlFor={inputId} className={styles.srOnly}>
          Новое название пресета
        </label>
        <input
          id={inputId}
          className={styles.input}
          value={name}
          maxLength={40}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(false);
          }}
          aria-invalid={error !== null}
        />
        <button type="submit" className={styles.button}>
          Сохранить
        </button>
        <button type="button" className={styles.button} onClick={() => setRenaming(false)}>
          Отмена
        </button>
        {error && (
          <div className={styles.error} role="alert">
            {PRESET_ERROR_TEXT[error]}
          </div>
        )}
      </form>
    );
  }

  return (
    <div className={styles.row}>
      <div className={styles.name}>
        {preset.name}
        {selected && <span className={styles.badge}>{eq.enabled ? 'играет' : 'выбран'}</span>}
      </div>
      <button type="button" className={styles.button} disabled={selected && eq.enabled} onClick={() => setEq(applyPreset(eq, preset.id))}>
        Применить
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          setName(preset.name);
          setError(null);
          setRenaming(true);
        }}
      >
        Переименовать
      </button>
      <button type="button" className={[styles.button, styles.danger].join(' ')} onClick={remove}>
        Удалить
      </button>
    </div>
  );
}

/**
 * Раздел «Эквалайзер»: та же кривая, что в окошке у кнопки в панели плеера (одно состояние),
 * «Мои пресеты» и «Предусиление».
 */
export function EqualizerSection() {
  const [eq, setEq] = useEqualizer();
  const preampId = useId();

  return (
    <SettingsSection
      id="equalizer"
      icon={SlidersVertical}
      title="Эквалайзер"
      description="Меняет звучание всех треков. То же самое открывается кнопкой в панели плеера."
    >
      <EqPanel size="large" />

      <div className={styles.columns}>
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Мои пресеты</h3>
          {eq.presets.length === 0 ? (
            <p className={styles.empty}>Пока нет. Настрой кривую и нажми «Сохранить как пресет».</p>
          ) : (
            <div className={styles.list}>
              {eq.presets.map((p, i) => (
                <PresetRow key={p.id} preset={p} index={i} />
              ))}
            </div>
          )}
        </div>

        <div className={styles.block}>
          <label htmlFor={preampId} className={styles.preampHead}>
            <span className={styles.blockTitle}>Предусиление</span>
            <span className={styles.preampValue}>{gainText(eq.preamp)}</span>
          </label>
          <input
            id={preampId}
            type="range"
            className={styles.range}
            min={PREAMP_MIN}
            max={PREAMP_MAX}
            step={0.5}
            value={eq.preamp}
            aria-valuetext={gainText(eq.preamp)}
            onChange={(e) => setEq(setPreamp(eq, Number(e.target.value)))}
            style={{ '--fill': `${((eq.preamp - PREAMP_MIN) / (PREAMP_MAX - PREAMP_MIN)) * 100}%` } as CSSProperties}
          />
          <p className={styles.empty}>Убавь, если на сильном басе звук хрипит</p>
        </div>
      </div>
    </SettingsSection>
  );
}
