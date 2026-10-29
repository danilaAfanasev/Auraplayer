import { Check, Palette, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState, type MouseEvent } from 'react';
import { DEFAULT_THEME, THEME_PRESETS, type ThemePreset } from '../../../shared/palette';
import { SOUNDWAVE_STYLE_NAMES } from '../../../shared/soundwave';
import { SOUNDWAVE_STYLES, type SoundwaveStyle, type ThemeSettings } from '../../../shared/types';
import { Button } from '../../components/Button/Button';
import { SoundwavePreview } from '../../components/Soundwave/SoundwavePreview';
import { useSettings } from '../../stores/useSettings';
import type { ThemeOrigin } from '../../theme/themeTransition';
import styles from './AppearanceSection.module.css';
import { ColorPicker } from './ColorPicker';
import { SettingsSection } from './SettingsSection';
import { ThemePreview } from './ThemePreview';
import toggles from './YoutubeSection.module.css';

/** Точка анимации заливки для клика: место клика, а для клавиатуры (нет координат) — центр кнопки. */
function originOf(e: MouseEvent<HTMLElement>): ThemeOrigin {
  if (e.detail === 0) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: e.clientX, y: e.clientY };
}

const presetTheme = (p: ThemePreset): ThemeSettings => ({ presetId: p.id, accent: p.accent, background: p.background });

/** Если свои цвета совпали с готовой темой — это она и есть. */
function themeFromColors(accent: string, background: string): ThemeSettings {
  const preset = THEME_PRESETS.find((p) => p.accent === accent && p.background === background);
  return { presetId: preset?.id ?? null, accent, background };
}

/**
 * «Вид» саундвейва (макет `SettingsPicker`): сетка живых мини-превью шести видов и крупный предпросмотр выбранного.
 * Выбор сразу меняет фон окна и сохраняется; превью рисуют, только пока их видно.
 */
function SoundwaveStylePicker() {
  const current = useSettings((s) => s.settings.soundwaveStyle);
  const update = useSettings((s) => s.update);
  const pick = (soundwaveStyle: SoundwaveStyle) => update({ soundwaveStyle });
  return (
    <div className={styles.wave}>
      <div className={styles.waveKinds}>
        <h3 className={styles.waveHead}>Вид</h3>
        <div className={styles.waveGrid} role="radiogroup" aria-label="Вид саундвейва">
          {SOUNDWAVE_STYLES.map((kind) => {
            const selected = kind === current;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={selected}
                className={[styles.waveKind, selected ? styles.selected : ''].filter(Boolean).join(' ')}
                onClick={() => pick(kind)}
              >
                <span className={styles.waveMini}>
                  <SoundwavePreview style={kind} />
                </span>
                <span className={styles.waveName}>{SOUNDWAVE_STYLE_NAMES[kind]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className={styles.waveLive}>
        <h3 className={styles.waveHead}>Предпросмотр</h3>
        <div className={styles.waveBig}>
          <SoundwavePreview style={current} />
        </div>
        <p className={styles.waveNote}>Вид меняется сразу на фоне окна. Цвет — из темы оформления.</p>
      </div>
    </div>
  );
}

/** Секция «Оформление»: готовые темы карточками, свои цвета (акцент + фон), «Саундвейв на фоне» и его вид. */
export function AppearanceSection() {
  const theme = useSettings((s) => s.settings.theme);
  const applyTheme = useSettings((s) => s.applyTheme);
  const soundwave = useSettings((s) => s.settings.soundwave);
  const update = useSettings((s) => s.update);
  const soundwaveId = useId();

  // Черновик своих цветов: показывается в превью во время перетаскивания, в интерфейс уходит по отпусканию.
  const [draft, setDraft] = useState({ accent: theme.accent, background: theme.background });
  useEffect(() => {
    setDraft({ accent: theme.accent, background: theme.background });
  }, [theme.accent, theme.background]);

  const isDefault = theme.presetId === DEFAULT_THEME.presetId;

  return (
    <SettingsSection
      id="appearance"
      icon={Palette}
      title="Оформление"
      description="Выбери готовую тему или собери свои цвета — остальные оттенки подберутся сами."
    >
      <div className={styles.presets} role="radiogroup" aria-label="Готовые темы">
        {THEME_PRESETS.map((preset) => {
          const selected = theme.presetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={[styles.preset, selected ? styles.selected : ''].filter(Boolean).join(' ')}
              onClick={(e) => applyTheme(presetTheme(preset), originOf(e))}
            >
              <ThemePreview accent={preset.accent} background={preset.background} />
              <span className={styles.presetName}>{preset.name}</span>
              <span className={styles.check} aria-hidden="true">
                <Check size={14} strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.custom}>
        <div className={styles.customHead}>
          <h3>
            Свои цвета
            {theme.presetId === null && <span className={styles.badge}>выбраны</span>}
          </h3>
          <Button
            variant="outline"
            icon={RotateCcw}
            disabled={isDefault}
            onClick={(e) => applyTheme({ ...DEFAULT_THEME }, originOf(e))}
          >
            Сбросить
          </Button>
        </div>
        <div className={styles.customBody}>
          <div className={styles.pickers}>
            <ColorPicker
              label="Акцент"
              value={draft.accent}
              onPreview={(accent) => setDraft((d) => ({ ...d, accent }))}
              onCommit={(accent, origin) => applyTheme(themeFromColors(accent, draft.background), origin)}
            />
            <ColorPicker
              label="Фон"
              value={draft.background}
              onPreview={(background) => setDraft((d) => ({ ...d, background }))}
              onCommit={(background, origin) => applyTheme(themeFromColors(draft.accent, background), origin)}
            />
          </div>
          <div className={styles.livePreview}>
            <ThemePreview accent={draft.accent} background={draft.background} large />
          </div>
        </div>
      </div>

      <label className={toggles.toggleRow}>
        <span className={toggles.toggleText}>
          <span id={soundwaveId} className={toggles.toggleTitle}>
            Саундвейв на фоне
          </span>
          <span className={toggles.toggleSub}>
            {soundwave ? 'Живая волна звука за всем окном, в цвет темы' : 'Выключен: фон окна без волны'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={soundwave}
          aria-labelledby={soundwaveId}
          className={toggles.switch}
          onClick={(e) => {
            e.preventDefault();
            update({ soundwave: !soundwave });
          }}
        />
      </label>
      {soundwave && <SoundwaveStylePicker />}
    </SettingsSection>
  );
}
