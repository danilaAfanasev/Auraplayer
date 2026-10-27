// Точка входа main-процесса Aura.
import { app, BrowserWindow, Menu, protocol } from 'electron';
import { buildPalette } from '../shared/palette';
import { registerIpc } from './ipc';
import { attachFlushOnClose, registerQuitFlush } from './ipc/app';
import { cancelAllDownloads, mediaRoots, sweepDownloadLeftovers } from './ipc/downloads';
import { registerMediaKeys } from './ipc/media';
import { prepareYtDlpInBackground } from './ipc/ytdlp';
import { MEDIA_SCHEME_PRIVILEGES, registerMediaProtocol } from './protocol';
import { getSettings } from './settingsStore';
import { setStoreDir } from './store';
import { createMainWindow } from './window';

app.setName('Aura');
// Схема aura-media:// (скачанные и локальные файлы) — регистрируется до готовности приложения.
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES]);

// Один экземпляр: повторный запуск поднимает уже открытое окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  async function openMainWindow(): Promise<void> {
    const settings = await getSettings().catch(() => null);
    // Фон окна до первой отрисовки — цвет темы, чтобы не было вспышки.
    const background = settings
      ? buildPalette(settings.theme.accent, settings.theme.background)['--bg']
      : buildPalette('', '')['--bg'];
    mainWindow = createMainWindow(background);
    attachFlushOnClose(mainWindow);
    registerMediaKeys(mainWindow);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.aura.player');
    Menu.setApplicationMenu(null);
    setStoreDir(app.getPath('userData'));
    registerMediaProtocol(protocol, mediaRoots);
    registerIpc();
    // Выход посреди загрузки: отменить загрузки (с уборкой .part), потом дописать файлы.
    registerQuitFlush(cancelAllDownloads);
    // Обрывки загрузок, оставшиеся от прошлого запуска (сбой, принудительное закрытие).
    void sweepDownloadLeftovers();
    await openMainWindow();
    // yt-dlp скачивается в фоне, окно его не ждёт (полоска в сайдбаре).
    prepareYtDlpInBackground();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
