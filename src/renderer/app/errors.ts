/** Человеческий текст ошибки для уведомления (без стектрейса и служебных префиксов). */
export function errorMessage(err: unknown, fallback = 'Что-то пошло не так. Попробуй ещё раз.'): string {
  if (err instanceof Error && err.message) {
    // Electron иногда добавляет «Error invoking remote method '…': Error: » — убираем.
    return err.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
  }
  return fallback;
}
