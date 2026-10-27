// Отложенное сохранение (300 мс) с принудительным сбросом перед закрытием окна.

export const SAVE_DELAY_MS = 300;

type Flush = () => Promise<void>;
/** Сохранения, ждущие таймера. */
const pending = new Set<Flush>();
/** Сохранения, которые уже идут (таймер сработал, запрос в main отправлен). */
const inflight = new Set<Promise<void>>();

export interface DebouncedSaver<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
}

/** Копит последнее значение и сохраняет его через `delay` мс после последнего изменения. */
export function createDebouncedSaver<T>(
  save: (value: T) => Promise<void>,
  onError: (err: unknown) => void,
  delay = SAVE_DELAY_MS,
): DebouncedSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: { value: T } | null = null;

  const flush: Flush = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending.delete(flush);
    if (!latest) return;
    const { value } = latest;
    latest = null;
    const run = save(value).catch((err: unknown) => onError(err));
    inflight.add(run);
    try {
      await run;
    } finally {
      inflight.delete(run);
    }
  };

  return {
    schedule(value: T) {
      latest = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
      pending.add(flush);
    },
    flush,
  };
}

/** Сохраняет всё, что ждёт отложенной записи, и дожидается уже идущих сохранений. */
export async function flushPendingSaves(): Promise<void> {
  await Promise.all([...pending].map((f) => f()));
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
}

/** Что дописать в последний момент перед закрытием окна (например, точную позицию трека). */
const closeHooks = new Set<() => void>();

/**
 * Регистрирует действие перед закрытием окна. Оно выполняется до сброса отложенных сохранений,
 * поэтому то, что оно отдаст в `schedule`, успеет записаться. Возвращает отписку.
 */
export function onBeforeCloseSave(hook: () => void): () => void {
  closeHooks.add(hook);
  return () => closeHooks.delete(hook);
}

/** Перед закрытием: последние изменения, затем сброс всех отложенных сохранений. */
export async function prepareClose(): Promise<void> {
  for (const hook of [...closeHooks]) {
    try {
      hook();
    } catch (err) {
      console.error('[close] сохранение перед закрытием:', err);
    }
  }
  await flushPendingSaves();
}

// Main перед закрытием окна просит дописать всё и ждёт ответа (aura.onBeforeClose).
if (typeof window !== 'undefined' && window.aura?.onBeforeClose) {
  window.aura.onBeforeClose(() => prepareClose());
}
