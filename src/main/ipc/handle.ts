// Обёртка над ipcMain.handle: исключения не пересекают границу процессов —
// рендерер получает `IpcResult` с человеческим текстом ошибки (без стектрейса).
import { ipcMain } from 'electron';
import type { IpcResult } from '../../shared/api';
import { NOT_IMPLEMENTED_CODE, NOT_IMPLEMENTED_MESSAGE } from '../../shared/ipc';

const GENERIC_MESSAGE = 'Что-то пошло не так. Попробуй ещё раз.';

/** Ошибка, текст которой можно показать пользователю как есть. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'UserError';
  }
}

/** Заглушка для методов, которые реализуют следующие таски. */
export class NotImplementedError extends UserError {
  constructor() {
    super(NOT_IMPLEMENTED_MESSAGE, NOT_IMPLEMENTED_CODE);
  }
}

function toIpcError(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { message: err.message || GENERIC_MESSAGE, code: typeof code === 'string' ? code : undefined };
  }
  return { message: GENERIC_MESSAGE };
}

type Handler = (...args: never[]) => unknown;

export function handle<F extends Handler>(channel: string, fn: F): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<Awaited<ReturnType<F>>>> => {
    try {
      const value = (await fn(...(args as Parameters<F>))) as Awaited<ReturnType<F>>;
      return { ok: true, value };
    } catch (err) {
      if (!(err instanceof UserError)) console.error(`[ipc] ${channel}:`, err);
      return { ok: false, error: toIpcError(err) };
    }
  });
}

export function assertString(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string') throw new UserError(`Неверный параметр: ${what}`);
}
