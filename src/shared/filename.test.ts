import { describe, expect, it } from 'vitest';
import { safeFileName, uniquePath } from './filename';

describe('safeFileName', () => {
  it('«Исполнитель — Название.ext»', () => {
    expect(safeFileName('Kevin MacLeod', 'Local Forecast', 'mp3')).toBe('Kevin MacLeod — Local Forecast.mp3');
  });
  it('расширение без точки и в нижнем регистре', () => {
    expect(safeFileName('A', 'B', '.M4A')).toBe('A — B.m4a');
  });
  it('недопустимые для Windows символы заменяются', () => {
    const name = safeFileName('AC/DC', 'What? <Live>: "1979" | a*b\\c', 'mp3');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name).toBe('AC_DC — What_ _Live__ _1979_ _ a_b_c.mp3');
  });
  it('управляющие символы убираются, пробелы схлопываются, хвостовые точки срезаются', () => {
    expect(safeFileName('  Foo\tBar ', 'Baz\n...', 'ogg')).toBe('Foo Bar — Baz.ogg');
  });
  it('пустой исполнитель — только название; пустое название — заглушка', () => {
    expect(safeFileName('', 'Song', 'mp3')).toBe('Song.mp3');
    expect(safeFileName('Artist', '   ', 'mp3')).toBe('Artist — Без названия.mp3');
  });
  it('зарезервированные имена Windows не получаются', () => {
    expect(safeFileName('', 'CON', 'mp3')).toBe('_CON.mp3');
    expect(safeFileName('', 'lpt1', 'mp3')).toBe('_lpt1.mp3');
  });
  it('очень длинное имя укорачивается', () => {
    const name = safeFileName('A'.repeat(300), 'B'.repeat(300), 'mp3');
    expect(name.length).toBeLessThanOrEqual(184);
    expect(name.endsWith('.mp3')).toBe(true);
  });
});

describe('uniquePath', () => {
  it('свободное имя возвращается как есть (Windows-разделитель)', async () => {
    expect(await uniquePath('C:\\Music\\Aura', 'A — B.mp3', () => false)).toBe('C:\\Music\\Aura\\A — B.mp3');
  });
  it('совпадающие имена получают « (2)», « (3)»', async () => {
    const taken = new Set(['C:\\Music\\A — B.mp3', 'C:\\Music\\A — B (2).mp3']);
    expect(await uniquePath('C:\\Music\\', 'A — B.mp3', (p) => taken.has(p))).toBe('C:\\Music\\A — B (3).mp3');
  });
  it('работает с асинхронной проверкой и POSIX-путями', async () => {
    const taken = new Set(['/music/x.m4a']);
    expect(await uniquePath('/music', 'x.m4a', async (p) => taken.has(p))).toBe('/music/x (2).m4a');
  });
});
