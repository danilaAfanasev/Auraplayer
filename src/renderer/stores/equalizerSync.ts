// Настройки эквалайзера → звуковой граф. Зовёт сам `audioGraph` при создании графа (один раз):
// текущее состояние применяется сразу, дальше — каждая правка `Settings.equalizer` (окошко, раздел
// настроек, загрузка settings.json).
import { effectiveGains, type EqualizerSettings } from '../../shared/equalizer';
import { setEqualizer } from '../audioGraph';
import { useSettings } from './useSettings';

let started = false;

export function initEqualizerSync(): void {
  if (started) return;
  started = true;
  let last: EqualizerSettings | null = null;
  const apply = (eq: EqualizerSettings): void => {
    if (eq === last) return;
    last = eq;
    setEqualizer(effectiveGains(eq));
  };
  apply(useSettings.getState().settings.equalizer);
  useSettings.subscribe((s) => apply(s.settings.equalizer));
}
