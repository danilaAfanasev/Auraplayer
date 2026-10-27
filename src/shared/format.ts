// Форматирование времени для интерфейса (по-русски).

const UNKNOWN_DURATION = '–:––';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Длительность трека: `4:20`, `1:02:05`; неизвестная — `–:––`. */
export function formatDuration(sec: number | undefined | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return UNKNOWN_DURATION;
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Русское склонение по числу: `pluralRu(2, 'трек', 'трека', 'треков')` → `трека`. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Число треков словами: `1 трек`, `3 трека`, `12 треков`. */
export function formatTrackCount(n: number): string {
  return `${n} ${pluralRu(n, 'трек', 'трека', 'треков')}`;
}

/** Общая длительность списка: `42 мин`, `1 ч`, `3 ч 12 мин`. */
export function formatTotalDuration(sec: number): string {
  const minutes = Number.isFinite(sec) && sec > 0 ? Math.round(sec / 60) : 0;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** Сколько времени прошло: `только что`, `4 мин назад`, `2 ч назад`, `вчера`, `5 дней назад`, `3 июл`. */
export function timeAgo(ts: number, now: number): string {
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 60) return 'только что';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`;
  const date = new Date(ts);
  const base = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${date.getFullYear()}`;
}
