import { describe, expect, it } from 'vitest';
import {
  allPresets,
  applyPreset,
  BUILTIN_PRESETS,
  CUSTOM_PRESET_ID,
  defaultEqualizer,
  deletePreset,
  EQ_BANDS_HZ,
  effectiveGains,
  MAX_CUSTOM_PRESETS,
  nextPresetName,
  normalizeEqualizer,
  presetLabel,
  renamePreset,
  resetEqualizer,
  restorePreset,
  savePreset,
  setBandGain,
  setPreamp,
  type EqualizerSettings,
} from './equalizer';

const zeros = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function saved(eq: EqualizerSettings, name: string): EqualizerSettings {
  const r = savePreset(eq, name);
  if ('error' in r) throw new Error(r.error);
  return r.eq;
}

describe('пресеты и полосы', () => {
  it('10 полос 32 Гц…16 кГц и семь встроенных пресетов по порядку', () => {
    expect([...EQ_BANDS_HZ]).toEqual([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
    expect(BUILTIN_PRESETS.map((p) => [p.id, p.name])).toEqual([
      ['flat', 'Обычный'],
      ['bass', 'Бас'],
      ['vocal', 'Вокал'],
      ['hiphop', 'Хип-хоп'],
      ['electronic', 'Электроника'],
      ['rock', 'Рок'],
      ['quiet', 'Тихо'],
    ]);
    for (const p of BUILTIN_PRESETS) {
      expect(p.gains).toHaveLength(10);
      for (const g of p.gains) expect(Math.abs(g)).toBeLessThanOrEqual(12);
    }
    expect(BUILTIN_PRESETS[0].gains).toEqual(zeros);
  });

  it('по умолчанию выключен, «Обычный», нули, предусиление 0, своих пресетов нет', () => {
    expect(defaultEqualizer()).toEqual({ enabled: false, presetId: 'flat', gains: zeros, preamp: 0, presets: [] });
  });

  it('пресет «Бас» поднимает низ и не трогает верх; выбор пресета включает эквалайзер', () => {
    const eq = applyPreset(defaultEqualizer(), 'bass');
    expect(eq.presetId).toBe('bass');
    expect(eq.enabled).toBe(true);
    expect(eq.gains[0]).toBeGreaterThan(0);
    expect(eq.gains[9]).toBe(0);
    expect(presetLabel(eq)).toBe('Бас');
  });

  it('неизвестный пресет — без изменений', () => {
    const eq = defaultEqualizer();
    expect(applyPreset(eq, 'нет-такого')).toEqual(eq);
  });

  it('сдвиг точки: пресет становится «Свой», усиление зажато в ±12 с шагом 0,5, эквалайзер включается', () => {
    const base = applyPreset(defaultEqualizer(), 'rock');
    const eq = setBandGain({ ...base, enabled: false }, 2, 4.3);
    expect(eq.presetId).toBe(CUSTOM_PRESET_ID);
    expect(eq.enabled).toBe(true);
    expect(eq.gains[2]).toBe(4.5);
    expect(presetLabel(eq)).toBe('Свой');
    expect(setBandGain(eq, 0, 40).gains[0]).toBe(12);
    expect(setBandGain(eq, 9, -40).gains[9]).toBe(-12);
    // Остальные полосы и встроенный пресет не меняются.
    expect(eq.gains.filter((_, i) => i !== 2)).toEqual(base.gains.filter((_, i) => i !== 2));
    expect(BUILTIN_PRESETS.find((p) => p.id === 'rock')!.gains[2]).not.toBe(4.5);
  });

  it('полоса вне диапазона или не число — без изменений', () => {
    const eq = defaultEqualizer();
    expect(setBandGain(eq, 10, 3)).toEqual(eq);
    expect(setBandGain(eq, -1, 3)).toEqual(eq);
    expect(setBandGain(eq, 1, Number.NaN)).toEqual(eq);
  });

  it('предусиление зажато в −12…+6', () => {
    expect(setPreamp(defaultEqualizer(), -20).preamp).toBe(-12);
    expect(setPreamp(defaultEqualizer(), 9).preamp).toBe(6);
    expect(setPreamp(defaultEqualizer(), -3.2).preamp).toBe(-3);
  });

  it('«Сбросить» — «Обычный» и нули, мои пресеты остаются', () => {
    const eq = saved(setBandGain(defaultEqualizer(), 0, 6), 'Мой');
    const reset = resetEqualizer(setBandGain(eq, 3, -5));
    expect(reset.presetId).toBe('flat');
    expect(reset.gains).toEqual(zeros);
    expect(reset.presets.map((p) => p.name)).toEqual(['Мой']);
  });
});

describe('мои пресеты', () => {
  it('сохранение: пресет после встроенных, выбран, с текущими полосами', () => {
    const eq = setBandGain(defaultEqualizer(), 1, 5);
    const next = saved(eq, '  Наушники  ');
    const mine = next.presets[0];
    expect(mine.name).toBe('Наушники');
    expect(mine.gains[1]).toBe(5);
    expect(next.presetId).toBe(mine.id);
    expect(presetLabel(next)).toBe('Наушники');
    const all = allPresets(next);
    expect(all.slice(0, BUILTIN_PRESETS.length)).toEqual(BUILTIN_PRESETS);
    expect(all[all.length - 1]).toEqual(mine);
    // Свой пресет — копия: дальнейшая правка полос его не меняет.
    expect(setBandGain(next, 1, -5).presets[0].gains[1]).toBe(5);
  });

  it('пустое имя и повтор имени (своего или встроенного, без учёта регистра) не принимаются', () => {
    const eq = saved(defaultEqualizer(), 'Наушники');
    expect(savePreset(eq, '   ')).toEqual({ error: 'empty' });
    expect(savePreset(eq, 'наушники')).toEqual({ error: 'duplicate' });
    expect(savePreset(eq, 'БАС')).toEqual({ error: 'duplicate' });
    expect(savePreset(eq, 'Свой')).toEqual({ error: 'duplicate' });
  });

  it('не больше 20 моих пресетов', () => {
    let eq = defaultEqualizer();
    for (let i = 1; i <= MAX_CUSTOM_PRESETS; i++) eq = saved(eq, `П${i}`);
    expect(MAX_CUSTOM_PRESETS).toBe(20);
    expect(eq.presets).toHaveLength(20);
    expect(new Set(eq.presets.map((p) => p.id)).size).toBe(20);
    expect(savePreset(eq, 'Ещё один')).toEqual({ error: 'limit' });
  });

  it('имя по умолчанию — «Мой пресет N», первое свободное', () => {
    expect(nextPresetName(defaultEqualizer())).toBe('Мой пресет 1');
    const eq = saved(saved(defaultEqualizer(), 'Мой пресет 1'), 'Мой пресет 3');
    expect(nextPresetName(eq)).toBe('Мой пресет 2');
  });

  it('переименование: новое имя видно в подписи; повтор чужого имени и пустое — ошибка; своё же имя — можно', () => {
    const eq = saved(saved(defaultEqualizer(), 'Первый'), 'Второй');
    const [first, second] = eq.presets;
    const r = renamePreset(eq, second.id, 'Вечер');
    if ('error' in r) throw new Error(r.error);
    expect(r.eq.presets.map((p) => p.name)).toEqual(['Первый', 'Вечер']);
    expect(presetLabel(r.eq)).toBe('Вечер');
    expect(renamePreset(eq, second.id, 'первый')).toEqual({ error: 'duplicate' });
    expect(renamePreset(eq, second.id, ' ')).toEqual({ error: 'empty' });
    expect('eq' in renamePreset(eq, first.id, 'Первый')).toBe(true);
  });

  it('удаление выбранного пресета оставляет звук как был, пресет — «Свой»; «Вернуть» ставит его на место', () => {
    const eq = saved(saved(setBandGain(defaultEqualizer(), 0, 6), 'А'), 'Б');
    const [a] = eq.presets;
    const picked = applyPreset(eq, a.id);
    const removed = deletePreset(picked, a.id);
    expect(removed.presets.map((p) => p.name)).toEqual(['Б']);
    expect(removed.presetId).toBe(CUSTOM_PRESET_ID);
    expect(removed.gains).toEqual(picked.gains);
    const back = restorePreset(removed, a, 0);
    expect(back.presets.map((p) => p.name)).toEqual(['А', 'Б']);
    // Удаление невыбранного пресета выбор не меняет.
    expect(deletePreset(picked, eq.presets[1].id).presetId).toBe(a.id);
  });
});

describe('effectiveGains', () => {
  it('выключенный эквалайзер — все нули и без предусиления', () => {
    const eq = setPreamp(applyPreset(defaultEqualizer(), 'bass'), -4);
    expect(effectiveGains({ ...eq, enabled: false })).toEqual({ preamp: 0, gains: zeros });
  });

  it('включённый — его полосы и предусиление', () => {
    const eq = setPreamp(applyPreset(defaultEqualizer(), 'bass'), -4);
    const bass = BUILTIN_PRESETS.find((p) => p.id === 'bass')!;
    expect(effectiveGains(eq)).toEqual({ preamp: -4, gains: bass.gains });
  });
});

describe('normalizeEqualizer', () => {
  it('мусор и отсутствие — значения по умолчанию', () => {
    expect(normalizeEqualizer(undefined)).toEqual(defaultEqualizer());
    expect(normalizeEqualizer('x')).toEqual(defaultEqualizer());
    expect(normalizeEqualizer({ enabled: 'да', gains: [1, 2], preamp: 'много' })).toEqual(defaultEqualizer());
  });

  it('сохранённое состояние восстанавливается; лишнее зажимается и отбрасывается', () => {
    const eq = setPreamp(saved(setBandGain(defaultEqualizer(), 4, 3), 'Мой'), -2);
    expect(normalizeEqualizer(JSON.parse(JSON.stringify(eq)))).toEqual(eq);
    const raw = {
      enabled: true,
      presetId: 'нет-такого',
      gains: [30, 0, 0, 0, 0, 0, 0, 0, 0, -30],
      preamp: 10,
      presets: [
        { id: 'a', name: 'А', gains: zeros },
        { id: 'a', name: 'Другой с тем же id', gains: zeros },
        { id: 'b', name: 'а', gains: zeros },
        { id: 'c', name: 'Кривой', gains: [1] },
        { id: 'd', name: '  ', gains: zeros },
        'мусор',
      ],
    };
    const n = normalizeEqualizer(raw);
    expect(n.enabled).toBe(true);
    expect(n.presetId).toBe(CUSTOM_PRESET_ID);
    expect(n.gains[0]).toBe(12);
    expect(n.gains[9]).toBe(-12);
    expect(n.preamp).toBe(6);
    expect(n.presets.map((p) => p.id)).toEqual(['a']);
  });

  it('больше 20 своих пресетов — лишние отбрасываются', () => {
    const presets = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, name: `П${i}`, gains: zeros }));
    expect(normalizeEqualizer({ ...defaultEqualizer(), presets }).presets).toHaveLength(20);
  });
});
