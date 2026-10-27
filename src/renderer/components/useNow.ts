import { useEffect, useState } from 'react';

/** Подписи вида «4 мин назад» достаточно обновлять раз в полминуты. */
export const NOW_TICK_MS = 30_000;

/** Текущее время, которое обновляется каждые `intervalMs` — для «N мин назад». */
export function useNow(intervalMs = NOW_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
