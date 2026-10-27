// Мост window.aura: единственный доступ рендерера к системе.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AuraApi, IpcResult } from '../shared/api';
import { IPC } from '../shared/ipc';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: AuraApi = {
  search: (source, query) => invoke(IPC.sources.search, source, query),
  featured: (source) => invoke(IPC.sources.featured, source),
  byTag: (source, tag) => invoke(IPC.sources.byTag, source, tag),
  resolveStream: (track, opts) => invoke(IPC.sources.resolveStream, track, opts ?? {}),
  prepareStreams: (owner, tracks) => invoke(IPC.sources.prepare, owner, tracks),
  library: {
    load: () => invoke(IPC.library.load),
    save: (lib) => invoke(IPC.library.save, lib),
  },
  settings: {
    load: () => invoke(IPC.settings.load),
    save: (s) => invoke(IPC.settings.save, s),
  },
  downloads: {
    start: (track) => invoke(IPC.downloads.start, track),
    cancel: (trackId) => invoke(IPC.downloads.cancel, trackId),
    list: () => invoke(IPC.downloads.list),
    remove: (trackId) => invoke(IPC.downloads.remove, trackId),
    onState: (cb) => subscribe(IPC.downloads.state, cb),
  },
  local: {
    pickFolder: () => invoke(IPC.local.pickFolder),
    rescan: () => invoke(IPC.local.rescan),
    tracks: () => invoke(IPC.local.tracks),
  },
  ytdlp: {
    status: () => invoke(IPC.ytdlp.status),
    update: () => invoke(IPC.ytdlp.update),
    install: () => invoke(IPC.ytdlp.install),
    onProgress: (cb) => subscribe(IPC.ytdlp.progress, cb),
  },
  charts: {
    get: () => invoke(IPC.charts.get),
    refresh: () => invoke(IPC.charts.refresh),
    onUpdate: (cb) => subscribe(IPC.charts.update, cb),
  },
  artists: {
    search: (query) => invoke(IPC.artists.search, query),
    page: (query) => invoke(IPC.artists.page, query),
    release: (releaseId) => invoke(IPC.artists.release, releaseId),
    album: (releaseId) => invoke(IPC.artists.album, releaseId),
    popular: () => invoke(IPC.artists.popular),
    feed: () => invoke(IPC.artists.feed),
    refreshFeed: () => invoke(IPC.artists.refreshFeed),
    onFeed: (cb) => subscribe(IPC.artists.feedUpdate, cb),
  },
  soundcloud: {
    chart: (query, opts) => invoke(IPC.soundcloud.chart, query, opts ?? {}),
  },
  wave: {
    start: (seed) => invoke(IPC.wave.start, seed),
    more: (req) => invoke(IPC.wave.more, req),
  },
  pickDownloadDir: () => invoke(IPC.system.pickDownloadDir),
  openExternal: (url) => invoke(IPC.system.openExternal, url),
  showInFolder: (path) => invoke(IPC.system.showInFolder, path),
  window: {
    minimize: () => ipcRenderer.send(IPC.window.minimize),
    toggleMaximize: () => ipcRenderer.send(IPC.window.toggleMaximize),
    close: () => ipcRenderer.send(IPC.window.close),
    onMaximized: (cb) => subscribe(IPC.window.maximized, cb),
  },
  onMediaKey: (cb) => subscribe(IPC.media.key, cb),
  onBeforeClose: (cb) =>
    subscribe<number>(IPC.app.flushRequest, (id) => {
      void Promise.resolve()
        .then(() => cb())
        .catch(() => undefined)
        .finally(() => ipcRenderer.send(IPC.app.flushDone, id));
    }),
};

contextBridge.exposeInMainWorld('aura', api);
