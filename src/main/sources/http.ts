// Сетевые запросы адаптеров: JSON с таймаутом, ошибки сети → SourceError нужного вида.
import { SourceError } from './types';

export const DEFAULT_TIMEOUT_MS = 12_000;

const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function causeCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Ошибку `fetch` превращает в состояние источника: нет сети или сервис не ответил. */
export function classifyFetchError(err: unknown): SourceError {
  if (err instanceof SourceError) return err;
  const code = causeCode(err);
  if (code && OFFLINE_CODES.has(code)) return new SourceError('offline');
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new SourceError('unavailable');
  if (err instanceof TypeError) return new SourceError('offline'); // «fetch failed» без кода — сеть недоступна
  return new SourceError('unknown');
}

export async function fetchJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': 'Aura/0.1 (desktop audio player)' },
    });
  } catch (err) {
    throw classifyFetchError(err);
  }
  if (!res.ok) throw new SourceError('unavailable');
  try {
    return await res.json();
  } catch (err) {
    const classified = classifyFetchError(err);
    throw classified.kind === 'unknown' ? new SourceError('unavailable') : classified;
  }
}
