// Регистрация всех IPC-обработчиков. Каждая область — в своём файле, чтобы таски не правили один файл.
import { registerArtistsIpc } from './artists';
import { registerChartsIpc } from './charts';
import { registerDownloadsIpc } from './downloads';
import { registerLibraryIpc } from './library';
import { registerLocalIpc } from './local';
import { registerLyricsIpc } from './lyrics';
import { registerSettingsIpc } from './settings';
import { registerSoundcloudIpc } from './soundcloud';
import { registerSourcesIpc } from './sources';
import { registerSystemIpc } from './system';
import { registerUpdateIpc } from './update';
import { registerWaveIpc } from './wave';
import { registerWindowIpc } from './window';
import { registerYtDlpIpc } from './ytdlp';

export function registerIpc(): void {
  registerWindowIpc();
  registerSettingsIpc();
  registerLibraryIpc();
  registerSourcesIpc();
  registerDownloadsIpc();
  registerLocalIpc();
  registerYtDlpIpc();
  registerSystemIpc();
  registerChartsIpc();
  registerArtistsIpc();
  registerWaveIpc();
  registerSoundcloudIpc();
  registerUpdateIpc();
  registerLyricsIpc();
}
