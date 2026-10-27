// Надёжное сохранение при закрытии: окно закрывается только после того, как рендерер
// дописал отложенные сохранения, а main — все начатые записи на диск.
import { app, ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import { flushWrites } from '../store';

/** Сколько ждём рендерер, если он завис или не отвечает. */
const RENDERER_FLUSH_TIMEOUT_MS = 3000;

let requestSeq = 0;

function requestRendererFlush(win: BrowserWindow): Promise<void> {
  const wc = win.webContents;
  if (wc.isDestroyed() || wc.isCrashed() || wc.isLoading()) return Promise.resolve();
  const id = ++requestSeq;
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      ipcMain.removeListener(IPC.app.flushDone, onDone);
      resolve();
    };
    const onDone = (event: IpcMainEvent, doneId: unknown) => {
      if (event.sender === wc && doneId === id) finish();
    };
    const timer = setTimeout(finish, RENDERER_FLUSH_TIMEOUT_MS);
    ipcMain.on(IPC.app.flushDone, onDone);
    wc.send(IPC.app.flushRequest, id);
  });
}

/** Перехватывает закрытие окна (кнопка, Alt+F4, панель задач): сначала сохранения, потом закрытие. */
export function attachFlushOnClose(win: BrowserWindow): void {
  let flushed = false;
  let flushing = false;
  win.on('close', (event) => {
    if (flushed) return;
    event.preventDefault();
    if (flushing) return;
    flushing = true;
    void requestRendererFlush(win)
      .then(() => flushWrites())
      .catch((err: unknown) => console.error('[close] сохранение перед закрытием:', err))
      .finally(() => {
        flushed = true;
        if (!win.isDestroyed()) win.close();
      });
  });
}

/**
 * Перед выходом из приложения: `prepare` (например, отмена идущих загрузок с уборкой частичных
 * файлов — сама ограничивает своё ожидание), затем ожидание всех начатых записей на диск.
 */
export function registerQuitFlush(prepare: () => Promise<void> = async () => undefined): void {
  let ready = false;
  let quitting = false;
  app.on('before-quit', (event) => {
    if (ready) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => prepare())()
      .catch((err: unknown) => console.error('[quit] подготовка к выходу:', err))
      .then(() => flushWrites())
      .catch((err: unknown) => console.error('[quit] сохранение перед выходом:', err))
      .finally(() => {
        ready = true;
        app.quit();
      });
  });
}
