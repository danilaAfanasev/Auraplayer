import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THUMBS,
  compactThumb,
  DEFAULT_THUMB_CHOICE,
  MAX_CUSTOM_THUMBS,
  THUMB_GRID,
  emptyPixels,
  floodFill,
  isEmptyThumb,
  normalizeCustomThumbs,
  normalizeThumbChoice,
  setPixel,
  thumbArt,
  type CustomThumb,
} from './progressThumb';

const N = THUMB_GRID * THUMB_GRID;

/** Сетка из строк по 24 символа: короткие строки добиваются прозрачными. */
function grid(rows: string[]): string {
  const padded = rows.map((r) => r.padEnd(THUMB_GRID, '.'));
  while (padded.length < THUMB_GRID) padded.push('.'.repeat(THUMB_GRID));
  return padded.join('');
}

function custom(over: Partial<CustomThumb> = {}): CustomThumb {
  return { id: 'c1', name: 'Мой', palette: ['#ff0000', '#00ff00'], pixels: setPixel(emptyPixels(), 5, '0'), ...over };
}

describe('встроенные значки', () => {
  it('16 штук, первый — кружок; id разные; подписи по-русски и без названий игр и сервисов', () => {
    expect(BUILTIN_THUMBS).toHaveLength(16);
    expect(BUILTIN_THUMBS[0]).toEqual({ id: 'dot', name: 'Кружок' });
    expect(new Set(BUILTIN_THUMBS.map((t) => t.id)).size).toBe(16);
    const names = BUILTIN_THUMBS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['«67»', 'Прицел', 'Пластинка', 'Нота', 'Огонёк', 'Молния', 'Сердце', 'Череп', 'Звезда', 'Призрак', 'Ракета', 'Кассета', 'Алмаз']));
    for (const name of names) expect(name).not.toMatch(/cs|counter|dota|minecraft|yandex|яндекс|spotify|apple|youtube/i);
  });
});

describe('normalizeThumbChoice', () => {
  it('мусор и пустое — кружок', () => {
    for (const bad of [undefined, null, 5, 'dot', [], {}, { kind: 'builtin' }, { kind: 'zzz', id: 'dot' }]) {
      expect(normalizeThumbChoice(bad, [])).toEqual(DEFAULT_THUMB_CHOICE);
    }
  });
  it('встроенный — как есть; неизвестный встроенный — кружок', () => {
    expect(normalizeThumbChoice({ kind: 'builtin', id: 'skull' }, [])).toEqual({ kind: 'builtin', id: 'skull' });
    expect(normalizeThumbChoice({ kind: 'builtin', id: 'tank' }, [])).toEqual(DEFAULT_THUMB_CHOICE);
  });
  it('свой — пока он есть в списке; удалённый выбранный значок — кружок', () => {
    expect(normalizeThumbChoice({ kind: 'custom', id: 'c1' }, [custom()])).toEqual({ kind: 'custom', id: 'c1' });
    expect(normalizeThumbChoice({ kind: 'custom', id: 'c1' }, [])).toEqual(DEFAULT_THUMB_CHOICE);
    expect(normalizeThumbChoice({ kind: 'custom', id: 'other' }, [custom()])).toEqual(DEFAULT_THUMB_CHOICE);
  });
});

describe('normalizeCustomThumbs', () => {
  it('не массив — пусто; целая запись сохраняется без изменений', () => {
    expect(normalizeCustomThumbs(undefined)).toEqual([]);
    expect(normalizeCustomThumbs({ id: 'c1' })).toEqual([]);
    const t = custom();
    expect(normalizeCustomThumbs(JSON.parse(JSON.stringify([t])))).toEqual([t]);
  });
  it('битые записи отбрасываются, целые остаются', () => {
    const good = custom({ id: 'good' });
    const raw = [
      null,
      'строка',
      { ...custom({ id: 'a' }), pixels: 'x'.repeat(N) }, // чужие символы
      { ...custom({ id: 'b' }), pixels: '.'.repeat(N - 1) + '0' + '.' }, // длина 577
      { ...custom({ id: 'c' }), pixels: setPixel(emptyPixels(), 0, '1'), palette: ['#ff0000'] }, // индекс вне палитры
      { ...custom({ id: 'd' }), palette: ['красный'] }, // цвет не #rrggbb
      { ...custom({ id: 'e' }), palette: Array.from({ length: 17 }, () => '#000000') }, // больше 16 цветов
      { ...custom({ id: 'f' }), pixels: emptyPixels() }, // пустой рисунок
      { ...custom({ id: '' }) },
      { ...custom({ id: 'g' }), name: 7 },
      good,
    ];
    expect(normalizeCustomThumbs(raw)).toEqual([good]);
  });
  it('повторный id — только первый; не больше 12; имя обрезается по краям и до 24 символов; цвета в нижнем регистре', () => {
    const many = Array.from({ length: 15 }, (_, i) => custom({ id: `t${i}` }));
    expect(normalizeCustomThumbs(many)).toHaveLength(MAX_CUSTOM_THUMBS);
    expect(normalizeCustomThumbs([custom({ id: 'x', name: 'первый' }), custom({ id: 'x', name: 'второй' })]).map((t) => t.name)).toEqual(['первый']);
    const [t] = normalizeCustomThumbs([custom({ name: `  ${'я'.repeat(40)}  `, palette: ['#FF00AA', '#00ff00'] })]);
    expect(t.name).toBe('я'.repeat(24));
    expect(t.palette).toEqual(['#ff00aa', '#00ff00']);
  });
});

describe('isEmptyThumb', () => {
  it('пустой — только прозрачные клетки', () => {
    expect(isEmptyThumb({ pixels: emptyPixels() })).toBe(true);
    expect(isEmptyThumb({ pixels: setPixel(emptyPixels(), 575, 'a') })).toBe(false);
  });
});

describe('floodFill', () => {
  it('заливает связную область и не выходит за стену', () => {
    // Стена из цвета «1» по столбцу 3 на всю высоту: левая часть — 3 столбца.
    const wall = Array.from({ length: THUMB_GRID }, () => '...1').join('\n').split('\n');
    const filled = floodFill(grid(wall), 0, '0');
    for (let y = 0; y < THUMB_GRID; y++) {
      for (let x = 0; x < THUMB_GRID; x++) {
        const c = filled[y * THUMB_GRID + x];
        expect(c).toBe(x < 3 ? '0' : x === 3 ? '1' : '.');
      }
    }
  });
  it('считает соседями только клетки сбоку и сверху-снизу — по диагонали заливка не идёт', () => {
    const rows = ['.1', '1.'];
    const filled = floodFill(grid(rows), 0, '0');
    expect(filled[0]).toBe('0');
    expect(filled[THUMB_GRID + 1]).toBe('.');
  });
  it('цвет клетки уже такой — рисунок не меняется; пустая заливка («.») стирает область', () => {
    const p = setPixel(emptyPixels(), 10, '2');
    expect(floodFill(p, 10, '2')).toBe(p);
    expect(floodFill(p, 10, '.')).toBe(emptyPixels());
  });
  it('клетка вне сетки — без изменений', () => {
    const p = emptyPixels();
    expect(floodFill(p, -1, '0')).toBe(p);
    expect(floodFill(p, N, '0')).toBe(p);
  });
});

describe('thumbArt', () => {
  it('кружок — null (рисует обычный стиль ползунка)', () => {
    expect(thumbArt(DEFAULT_THUMB_CHOICE, [])).toBeNull();
  });
  it('встроенный — маска в цвет темы; пластинка крутится, остальные нет', () => {
    for (const { id } of BUILTIN_THUMBS.filter((t) => t.id !== 'dot')) {
      const art = thumbArt({ kind: 'builtin', id }, []);
      expect(art?.mode).toBe('mask');
      expect(art?.svg.startsWith('<svg')).toBe(true);
      expect(art?.spin).toBe(id === 'vinyl');
    }
  });
  it('свой — картинка в своих цветах, ряд одного цвета склеен в один прямоугольник', () => {
    let pixels = emptyPixels();
    for (const x of [2, 3, 4]) pixels = setPixel(pixels, 1 * THUMB_GRID + x, '0');
    pixels = setPixel(pixels, 2 * THUMB_GRID + 2, '1');
    const art = thumbArt({ kind: 'custom', id: 'c1' }, [custom({ pixels, palette: ['#ff0000', '#00ff00'] })]);
    expect(art?.mode).toBe('image');
    expect(art?.svg).toContain('<rect x="2" y="1" width="3" height="1" fill="#ff0000"/>');
    expect(art?.svg).toContain('<rect x="2" y="2" width="1" height="1" fill="#00ff00"/>');
    expect(art?.svg.match(/<rect/g)).toHaveLength(2);
    expect(art?.spin).toBe(false);
  });
  it('свой удалён — null', () => {
    expect(thumbArt({ kind: 'custom', id: 'gone' }, [custom()])).toBeNull();
  });
});

describe('compactThumb', () => {
  it('убирает неиспользованные цвета и перенумеровывает остальные по порядку появления на рисунке', () => {
    let pixels = emptyPixels();
    pixels = setPixel(pixels, 0, '3');
    pixels = setPixel(pixels, 1, '1');
    pixels = setPixel(pixels, 2, '3');
    const r = compactThumb(['#000001', '#000002', '#000003', '#000004'], pixels);
    expect(r.palette).toEqual(['#000004', '#000002']);
    expect(r.pixels.slice(0, 4)).toBe('010.');
    expect(r.pixels).toHaveLength(N);
  });
  it('пустой рисунок — пустая палитра', () => {
    expect(compactThumb(['#ffffff'], emptyPixels())).toEqual({ palette: [], pixels: emptyPixels() });
  });
});
