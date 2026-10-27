// Свои кнопки окна (свернуть / развернуть / закрыть) и состояние «развёрнуто».
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { IPC } from '../../shared/ipc';

function windowOf(event: IpcMainEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowIpc(): void {
  ipcMain.removeAllListeners(IPC.window.minimize);
  ipcMain.removeAllListeners(IPC.window.toggleMaximize);
  ipcMain.removeAllListeners(IPC.window.close);

  ipcMain.on(IPC.window.minimize, (e) => windowOf(e)?.minimize());
  ipcMain.on(IPC.window.toggleMaximize, (e) => {
    const win = windowOf(e);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(IPC.window.close, (e) => windowOf(e)?.close());
}

/** Сообщает рендереру о смене «развёрнуто/обычное» (иконка кнопки меняется). */
export function attachWindowState(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.window.maximized, win.isMaximized());
  };
  win.on('maximize', send);
  win.on('unmaximize', send);
  win.webContents.on('did-finish-load', send);
}
