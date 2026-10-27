// Разбор исполнителей трека — один на всё приложение: волна, чёрный список, вкус, ссылки на артистов.
// Строка исполнителя склеена («A & B», «A feat. B»), фит бывает и в названии («Song (feat. X)»).

/** Регистр, ё, знаки препинания и символы ($, «») не важны: «Toxi$» и «toxi» — один исполнитель. */
export function artistKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Слова, после которых в строке идёт соисполнитель. */
const FEAT = String.raw`(?:feat\.?|ft\.?|featuring|при\s+уч\.?|при\s+участии)`;

/** Разделители соисполнителей в строке исполнителя. */
const ARTIST_SPLIT = new RegExp(String.raw`\s*(?:,|&|\+|×|\/)\s*|\s+(?:${FEAT}|x|with|vs\.?)\s+`, 'iu');

/** Фит в скобках: «(feat. X)», «[ft. X]», «(with X)», «(при уч. X)». «[prod. X]» — не исполнитель. */
const BRACKET_FEAT = new RegExp(String.raw`[(\[]\s*(?:${FEAT}|with)\s+([^)\]]+)[)\]]`, 'giu');

/** Фит без скобок: «Song ft. X», «Song feat. X - Remix» — до скобки, тире или конца строки. «with» без скобок — часть названия. */
const PLAIN_FEAT = new RegExp(String.raw`(?:^|\s)${FEAT}\s+(.+?)(?=\s*[(\[]|\s+[-–—]\s+|$)`, 'giu');

/**
 * Имена, в которых есть разделитель, — не резать. Короткий список известных случаев,
 * сравнение без регистра.
 */
const UNSPLITTABLE = [
  'Tyler, The Creator',
  'AC/DC',
  'Earth, Wind & Fire',
  'Florence + The Machine',
  'Simon & Garfunkel',
  'Hall & Oates',
  'Mumford & Sons',
  'Belle & Sebastian',
  'Chase & Status',
  'Above & Beyond',
  'Of Mice & Men',
  'Kool & The Gang',
  'Bob Marley & The Wailers',
  'Crosby, Stills & Nash',
];

/** Метка-заглушка для неразрезаемого имени: символ, которого нет ни в одном разделителе. */
const HOLD = '\u0000';

function decode(s: string): string {
  return s.replace(/&amp;/gi, '&');
}

/** Делит строку на имена по разделителям, не трогая имён из `UNSPLITTABLE`. */
function splitList(s: string): string[] {
  const held: string[] = [];
  let text = decode(s);
  const lower = () => text.toLowerCase();
  for (const name of UNSPLITTABLE) {
    let at = lower().indexOf(name.toLowerCase());
    while (at >= 0) {
      held.push(text.slice(at, at + name.length));
      const mark = `${HOLD}${held.length - 1}${HOLD}`;
      text = text.slice(0, at) + mark + text.slice(at + name.length);
      at = lower().indexOf(name.toLowerCase(), at + mark.length);
    }
  }
  return text
    .split(ARTIST_SPLIT)
    .map((part) => part.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_, i: string) => held[Number(i)]).trim())
    .map((part) => part.replace(/^[\s([{"«]+|[\s)\]}"»]+$/g, ''))
    .filter(Boolean);
}

/** Вынимает из строки фиты (в скобках и без) — остаток и найденные строки соисполнителей. */
function extractFeats(s: string): { rest: string; feats: string[] } {
  const feats: string[] = [];
  let rest = decode(s).replace(BRACKET_FEAT, (_, who: string) => {
    feats.push(who);
    return ' ';
  });
  rest = rest.replace(PLAIN_FEAT, (_, who: string) => {
    feats.push(who);
    return ' ';
  });
  return { rest: rest.trim(), feats };
}

/**
 * Исполнители трека как написаны, основной первым, без дублей (по `artistKey`):
 * «A & B feat. C» → ['A', 'B', 'C']; фиты из названия («Song (feat. X)», «ft. X», «при уч. X») — следом.
 */
export function splitArtists(artist: string, title?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (names: string[]) => {
    for (const name of names) {
      const key = artistKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  };
  // В поле исполнителя фит в скобках тоже бывает: «A (feat. B)».
  const fromArtist = extractFeats(artist);
  add(splitList(fromArtist.rest));
  for (const f of fromArtist.feats) add(splitList(f));
  if (title) for (const f of extractFeats(title).feats) add(splitList(f));
  return out;
}
