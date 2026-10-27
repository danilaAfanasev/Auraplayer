// Главное окно Aura: без системной рамки, своя верхняя полоса рисуется в рендерере.
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import icon from '../../resources/icon.png?asset';
import { isSafeExternalUrl } from './ipc/system';
import { attachWindowState } from './ipc/window';

export const MIN_WIDTH = 1100;
export const MIN_HEIGHT = 700;

export function createMainWindow(backgroundColor: string): BrowserWindow {
  const win = new BrowserWindow({
    title: 'Aura',
    width: 1380,
    height: 880,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    show: false,
    backgroundColor,
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  attachWindowState(win);

  // Заголовок окна всегда «Aura», даже если документ попробует его сменить.
  win.on('page-title-updated', (e) => e.preventDefault());

  // Никаких новых окон и переходов внутри приложения: веб-ссылки — во внешний браузер.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  // F12 — инструменты разработчика (только в режиме разработки).
  if (process.env.ELECTRON_RENDERER_URL) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
