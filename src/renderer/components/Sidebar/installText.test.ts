import { describe, expect, it } from 'vitest';
import { applyInstallEvent, installStatusText, type InstallPhase } from './installText';

describe('installStatusText', () => {
  it('с процентами, когда они известны', () => {
    expect(installStatusText(0.452)).toBe('Готовлю YouTube и SoundCloud… 45%');
    expect(installStatusText(1)).toBe('Готовлю YouTube и SoundCloud… 100%');
  });

  it('без процентов, пока размер неизвестен', () => {
    expect(installStatusText(-1)).toBe('Готовлю YouTube и SoundCloud…');
  });
});

describe('applyInstallEvent', () => {
  const idle: InstallPhase = { kind: 'idle' };

  it('установка идёт → полоска с процентами; готово → полоска исчезает', () => {
    const running = applyInstallEvent(idle, { stage: 'install', progress: 0.3 });
    expect(running).toEqual({ kind: 'running', progress: 0.3 });
    expect(applyInstallEvent(running, { stage: 'done', progress: 1 })).toEqual(idle);
  });

  it('ошибка во время установки → «Повторить»; ошибка обновления в настройках полоску не трогает', () => {
    expect(applyInstallEvent({ kind: 'running', progress: 0.3 }, { stage: 'error', progress: 0 })).toEqual({ kind: 'failed' });
    expect(applyInstallEvent(idle, { stage: 'error', progress: 0 })).toEqual(idle);
    expect(applyInstallEvent(idle, { stage: 'update', progress: 0.5 })).toEqual(idle);
  });

  it('повтор после ошибки снова показывает ход', () => {
    expect(applyInstallEvent({ kind: 'failed' }, { stage: 'install', progress: 0 })).toEqual({ kind: 'running', progress: 0 });
  });
});
