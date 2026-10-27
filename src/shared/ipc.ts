// Имена IPC-каналов: `aura:<область>:<действие>`. Общие для main и preload.

export const IPC = {
  sources: {
    search: 'aura:sources:search',
    featured: 'aura:sources:featured',
    byTag: 'aura:sources:by-tag',
    resolveStream: 'aura:sources:resolve-stream',
    prepare: 'aura:sources:prepare',
  },
  library: {
    load: 'aura:library:load',
    save: 'aura:library:save',
  },
  settings: {
    load: 'aura:settings:load',
    save: 'aura:settings:save',
  },
  downloads: {
    start: 'aura:downloads:start',
    cancel: 'aura:downloads:cancel',
    list: 'aura:downloads:list',
    remove: 'aura:downloads:remove',
    /** событие main → renderer: DownloadState */
    state: 'aura:downloads:state',
  },
  local: {
    pickFolder: 'aura:local:pick-folder',
    rescan: 'aura:local:rescan',
    tracks: 'aura:local:tracks',
  },
  ytdlp: {
    status: 'aura:ytdlp:status',
    update: 'aura:ytdlp:update',
    /** Скачать yt-dlp (первый запуск, «Повторить»); прогресс — событием `progress`. */
    install: 'aura:ytdlp:install',
    /** событие main → renderer: { stage, progress } */
    progress: 'aura:ytdlp:progress',
  },
  charts: {
    get: 'aura:charts:get',
    refresh: 'aura:charts:refresh',
    /** событие main → renderer: ChartsSnapshot */
    update: 'aura:charts:update',
  },
  artists: {
    search: 'aura:artists:search',
    page: 'aura:artists:page',
    release: 'aura:artists:release',
    album: 'aura:artists:album',
    popular: 'aura:artists:popular',
    feed: 'aura:artists:feed',
    refreshFeed: 'aura:artists:refresh-feed',
    /** событие main → renderer: ArtistFeedSnapshot */
    feedUpdate: 'aura:artists:feed-update',
  },
  soundcloud: {
    chart: 'aura:soundcloud:chart',
  },
  wave: {
    start: 'aura:wave:start',
    more: 'aura:wave:more',
  },
  system: {
    pickDownloadDir: 'aura:system:pick-download-dir',
    openExternal: 'aura:system:open-external',
    showInFolder: 'aura:system:show-in-folder',
  },
  window: {
    minimize: 'aura:window:minimize',
    toggleMaximize: 'aura:window:toggle-maximize',
    close: 'aura:window:close',
    /** событие main → renderer: boolean */
    maximized: 'aura:window:maximized',
  },
  app: {
    /** событие main → renderer: id запроса; рендерер дописывает сохранения и отвечает flushDone */
    flushRequest: 'aura:app:flush-request',
    /** renderer → main: id запроса */
    flushDone: 'aura:app:flush-done',
  },
  media: {
    /** событие main → renderer: MediaKey */
    key: 'aura:media:key',
  },
} as const;

/** Код ошибки для методов, которые реализуют следующие таски. */
export const NOT_IMPLEMENTED_CODE = 'not-implemented';
export const NOT_IMPLEMENTED_MESSAGE = 'Эта функция ещё не готова — она появится в следующих версиях Aura.';
