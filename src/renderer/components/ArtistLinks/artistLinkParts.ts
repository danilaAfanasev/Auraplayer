// Строка исполнителей трека → части для ссылок: имена (ссылки на страницу артиста) и текст между ними.
// Имена берутся из общего разбора `splitArtists`; текст строки остаётся как написан.
import { artistKey, splitArtists } from '../../../shared/artistNames';

export interface ArtistLinkPart {
  text: string;
  /** Имя исполнителя — часть кликабельна; нет — разделитель. */
  name?: string;
}

const decode = (s: string): string => s.replace(/&amp;/gi, '&');

/** Где в строке стоит имя: первое вхождение, не задевающее уже найденные, на границе слова. */
function locate(text: string, name: string, taken: { from: number; to: number }[]): number {
  const lower = text.toLowerCase();
  const want = name.toLowerCase();
  const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  for (let at = lower.indexOf(want); at >= 0; at = lower.indexOf(want, at + 1)) {
    const to = at + want.length;
    if (taken.some((r) => at < r.to && to > r.from)) continue;
    if (isWord(text[at - 1]) || isWord(text[to])) continue;
    return at;
  }
  return -1;
}

/**
 * «VILLIAN & madk1d» → VILLIAN (ссылка), « & », madk1d (ссылка). Фиты из названия («Song (feat. C)»),
 * которых нет в строке исполнителя, — следом: « feat. C».
 */
export function artistLinkParts(artist: string, title?: string): ArtistLinkPart[] {
  const text = decode(artist).trim();
  if (!text) return [];
  const found: { from: number; to: number; name: string }[] = [];
  const extra: string[] = [];
  const own = new Set<string>();
  for (const name of splitArtists(text)) {
    own.add(artistKey(name));
    const at = locate(text, name, found);
    if (at < 0) extra.push(name);
    else found.push({ from: at, to: at + name.length, name: text.slice(at, at + name.length) });
  }
  if (title) for (const name of splitArtists(text, title)) if (!own.has(artistKey(name))) extra.push(name);
  found.sort((a, b) => a.from - b.from);

  const out: ArtistLinkPart[] = [];
  let pos = 0;
  for (const f of found) {
    if (f.from > pos) out.push({ text: text.slice(pos, f.from) });
    out.push({ text: f.name, name: f.name });
    pos = f.to;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  if (found.length === 0) out.length = 0; // имя не нашлось в строке (не бывает) — строка целиком ниже
  if (out.length === 0 && extra.length === 0) return [{ text, name: text }];
  extra.forEach((name, i) => {
    if (out.length > 0) out.push({ text: i === 0 ? ' feat. ' : ', ' });
    out.push({ text: name, name });
  });
  return out;
}
