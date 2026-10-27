# Архитектура Aura

Электрон-приложение для Windows. Три процесса-слоя (main, preload, renderer) и общий слой `shared`. Термины («Источник», «Каталог», «Волна», «Чёрный список», «Вкус», «Скачанное», «Мои файлы») — в `CONTEXT.md`.

## Раскладка каталогов

```
src/
  shared/      типы и чистые функции для main и renderer (без electron и DOM)
  main/        окно, IPC, хранилище, источники (sources/), загрузки, yt-dlp, протокол aura-media
  preload/     мост window.aura
  renderer/    React: app/, components/, screens/, stores/, theme/, styles/
resources/     иконка (svg → png/ico через npm run icon)
scripts/       make-icon.mjs (иконка), make-public.mjs (чистая копия для публикации)
docs/          architecture.md, screenshots/
README.md, LICENSE   для публикации (MIT)
```

Тесты лежат рядом с модулем (`*.test.ts`). Образцы ответов внешних API — `src/main/sources/__fixtures__/`.

## Границы процессов

- Рендерер не ходит в сеть сам (исключения: `<img>` для обложек и `<audio>` для потока). Все запросы к API идут через main по IPC.
- Окно: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. К системе рендерер обращается только через `window.aura`.
- `window.aura` описан типом `AuraApi` в `src/shared/api.ts`; имена каналов — `IPC.<область>.<действие>` в `src/shared/ipc.ts`, вид `aura:<область>:<действие>`. Реализует мост `src/preload/index.ts`, обработчики — `src/main/ipc/<область>.ts` (все регистрируются в `ipc/index.ts`).
- `handle(channel, fn)` (`ipc/handle.ts`) оборачивает обработчик: исключение не пересекает границу, рендерер получает `IpcResult` с человеческим текстом (`UserError`), без стектрейса.
- События main → renderer: прогресс загрузки, прогресс yt-dlp, обновление чартов и ленты артистов, развёрнутость окна, медиаклавиши, запрос на сброс сохранений перед закрытием.
- Внешние ссылки открываются в браузере только для `http(s)` (`openExternal`); новые окна и переходы внутри приложения запрещены (`src/main/window.ts`).
- `shared/` не импортирует electron, DOM и ничего из main/renderer.

## Модель данных

`src/shared/types.ts`:

- `Track.id = "<source>:<sourceId>"` — стабильный ключ во всех списках. `Track.official` — признак «официальный звук» (канал «- Topic», «Official Audio» в названии), нужен фильтру не-треков. `SourceId`: `archive | youtube | soundcloud | local | catalog`. Для `local` `sourceId` — абсолютный путь файла, для `archive` — `"<identifier>/<файл>"`.
- `LibraryData` (`version: 1`): плейлисты, лайки, история (до 100), `followedArtists` (подписки на артистов), `blacklist` (чёрный список, `shared/blacklist.ts`), `taste` (журнал событий вкуса, рейтинг считает `shared/taste.ts`) и `tracks` — снимки метаданных только тех треков, на которые есть ссылки. Операции над ней — чистые функции `shared/library.ts`, каждая возвращает новый объект.
- `Settings` (`version: 1`): тема, `downloadDir`, `youtubeEnabled`, `soundcloudEnabled`, `waveAfterQueue`, `chartCountry` (`'auto'` или код страны), `onboarded` (прошёл ли первый запуск), `localFolders`, громкость и режимы, `lastSession`. У старого файла без поля `onboarded` значение `true` — существующему пользователю первый запуск не показывается. Лишние поля старых файлов (например, `jamendoClientId`) `normalizeSettings` отбрасывает.
- `SourceResult` — ответ источника: треки и необязательная ошибка (`offline | no-key | bad-key | unavailable | disabled | unknown`; `no-key`/`bad-key` остались в типе, ключей ни у одного источника нет).
- `artistNames.ts` — единый разбор исполнителей (`splitArtists`: «A & B», «feat.» в строке и в названии) и ключ сравнения `artistKey` (без регистра, ё, знаков); им пользуются волна, чёрный список, вкус и ссылки на артистов. `trackFilter.ts` — `isLikelyTrack`: отсев не-треков (шоу, подкасты, многочасовые миксы). `queue.ts` — выбор следующего/предыдущего трека и порядок перемешивания; `palette.ts` — вся палитра интерфейса из двух цветов (акцент и фон) с контрастом текста ≥ 4.5:1.

## Чёрный список и вкус

Оба живут в `library.json` рядом с лайками (`LibraryData.blacklist`, `LibraryData.taste`); логика — чистые функции `shared/blacklist.ts` и `shared/taste.ts`, операции над библиотекой — `shared/library.ts`.

- **Чёрный список**: скрытые треки (со снимком, чтобы показать и вернуть) и исполнители (по `artistKey`). Трек считается скрытым по id или по ключу песни (основной исполнитель + название без скобок), поэтому та же песня из другого источника скрыта тоже. «Не нравится» скрывает только трек; исполнитель попадает в список явным действием. Действия рендерера — `stores/blacklistActions.ts` (`dislikeTrack`, `restoreTrack`, `blockArtistEverywhere`, `restoreArtist`).
- **Фильтр действует в рендерере, на выдаче**: каждый список очищается до того, как попадёт в таблицу или в `playList` (`useVisibleTracks`, `visibleFeed`, `visibleArtistPage`, `isReleaseBlocked`, `withoutBlockedStatus`; `useCharts` и чарт SoundCloud отдают уже очищенное). Фильтровать надо строго до таблицы и запуска списка, иначе индексы показанных и играющих треков разойдутся. Кэши main остаются полными. `TrackTable` с `blockedMode: 'mute'` (по умолчанию) показывает скрытый трек приглушённым — для поиска. Новый список треков подключается к фильтру вручную.
- **Вкус** — журнал событий (`complete | like | follow | onboard | skip | dislike`, до 2000, с весами); рейтинг исполнителей считается при чтении с остыванием (период полураспада 14 дней). События пишет `stores/tasteTracking.ts` по `usePlayer.onTrackLeave` (прослушано от 80% — `complete`, переключено раньше 30 с — `skip`; трек, у которого звук ещё искался, — ничего), а также лайк, подписка, «Не нравится» и первый запуск. `stores/tasteWave.ts` строит из вкуса «Мою волну» (`myWaveSeed`) и чипы жанров (`tasteChips`).
- `normalizeLibrary` разбирает `blacklist` и `taste` своими ветками: id скрытых треков не обязаны быть в `tracks` (снимки лежат в самом списке).

## Хранилище

Всё в JSON в `app.getPath('userData')` (`%APPDATA%\Aura`), через `src/main/store.ts`: `readJson` / `writeJson`.

- Запись атомарная (временный файл → rename). Повреждённый файл откладывается в `<имя>.bak`, читается как пустой. Миграций нет, формат версионируется полем `version`.
- `flushWrites()` ждёт все начатые записи.
- Файлы: `library.json`, `settings.json`, `downloads.json`, `local-index.json`, `charts.json` (чарт), `catalog-matches.json` (трек каталога → видео YouTube), `artists-cache.json` (id артистов в каталоге и Deezer), `artist-feed.json` (лента подписок), `soundcloud-charts.json` (раздел SoundCloud). Каталоги: `bin/` (yt-dlp.exe), `ytdlp-cache/`, `covers/` (обложки «Моих файлов»).
- В рендерере: очередь воспроизведения (снимки треков) — в `localStorage` под ключом `aura.player.queue`, состояние сайдбара — `aura.sidebar.collapsed`. В настройках — только id очереди, индекс и позиция.

Сохранение из рендерера: сторы зовут `createDebouncedSaver` (`stores/persist.ts`, задержка 300 мс) → `aura.library.save` / `aura.settings.save`.

### Закрытие окна

`attachFlushOnClose` (`main/ipc/app.ts`) перехватывает `close`, просит рендерер дописать всё (`flushRequest` → `flushDone`, ожидание не дольше 3 с), затем `flushWrites()`, затем закрывает окно. Что нужно успеть записать в последний момент (например, позицию трека), рендерер регистрирует через `onBeforeCloseSave`. `registerQuitFlush` при выходе из приложения отменяет идущие загрузки (с уборкой `.part`) и тоже ждёт записи.

## Источники

Каждый источник — адаптер `SourceAdapter` (`main/sources/types.ts`) с методами `search`, необязательными `featured` / `byTag` / `download` и обязательным `resolveStream(track, ctx) → URL для <audio>`. Реестр — `sources/index.ts` (`getAdapter`, `querySource`, `resolveStream`). Новый источник — новый адаптер плюс запись в реестре и в `SourceId`, а не правка существующих.

- Отказ одного источника не трогает другие: `toSourceResult` превращает любую ошибку в `{ tracks: [], error }`; исключение до рендерера не доходит. Тексты ошибок — `SOURCE_ERROR_MESSAGES`.
- Разбор ответов API вынесен в чистые функции (`parseAlbumLookup`, `parsePopularArtists`, `parseArchiveSearch` / `parseArchiveFiles`, `parseYtSearch`, `parseScSearch`, `parseItunesTracks`, `parseItunesArtists`, `parseDeezerArtists`) и тестируется на образцах из `__fixtures__/`.
- Не-треки отсеивает `trackFilter.isLikelyTrack`: его зовут `youtube.search`, подбор волны (`isSongLike`, `isFreshSong`) и подборки жанра в рендерере (`screens/tag/genreQueries.ts`). «Remix», «Radio/Extended/Club Mix» проходят.
- `archive.ts` — без ключа. `local.ts` — сканирует `localFolders` через `music-metadata`, индекс и обложки кэширует. `youtube.ts` — через yt-dlp, выключается `youtubeEnabled`. `soundcloud.ts` — через yt-dlp (`scsearch`), выключается `soundcloudEnabled`; в выдачу не попадают 30-секундные отрывки и DRM-треки: их видно в ответе API поиска, который yt-dlp печатает по `--dump-pages` (запасной путь — проверка форматов отдельными процессами: ~4 запроса на трек, при частых поисках SoundCloud отвечает 403).
- `catalog.ts` — «Популярное сейчас» и поиск песен каталога: метаданные из открытого RSS-чарта и iTunes lookup/search по стране чарта (`main/country.ts`: настройка «Страна чарта» или страна системы, неизвестная — `us`), звука нет. При воспроизведении или скачивании ищется видео на YouTube (`runYtDlp`, до пяти кандидатов, подбор по длительности ±10 с и признакам официального аудио), найденное сопоставление кэшируется в `catalog-matches.json`; дальше работает YouTube-адаптер. Без включённого YouTube Каталог остаётся витриной (скачанное играет).
- Jamendo и раздел «Новинки» удалены. Трек `jamendo:…` в лайках, плейлистах и истории остаётся: `normalizeLibrary` (`keepRetired`) делает ему `source: 'local'`. Играет он только из скачанного файла: `normalizeRecords` в `downloads.ts` превращает его запись в файловый трек (`local:<путь>`), запомнив прежний id в `formerId`, и `findFile` находит копию по обоим id. Не скачанный даёт `RETIRED_SOURCE_MESSAGE` (`ipc/sources.ts`).
- `resolveStream` сначала ищет скачанную копию (`setDownloadedLookup` ← менеджер загрузок) и только потом идёт в адаптер: Скачанное играет без сети и приоритетнее потока. `opts.fresh` — повторная попытка плеера: адаптер не берёт сохранённую ссылку.
- Чарты: `main/charts.ts` — сервис со списками в `charts.json`, обновление при запуске и каждые 6 часов; `main/ipc/charts.ts` рассылает снимок `ChartsSnapshot` во все окна. Без сети остаётся последний сохранённый список.

### Артисты и лента

`sources/artists.ts` — `createArtistsService`, не адаптер: `search` (карточки над результатами поиска), `page` (популярные, альбомы и синглы без миксов и сборников, «Похожие»), `release`, `album` (страница альбома), `popular` (артисты из чарта своей страны с жанровыми тегами — подсказки первого запуска; кэш 6 часов), `buildFeed`. IPC — `ipc/artists.ts`, `window.aura.artists`.

- Метаданные и релизы — iTunes search/lookup по стране чарта и us. «Похожие» и фото — открытый API Deezer по имени артиста (`/artist/{id}/related`); id артиста кэшируется в `artists-cache.json`. Звук треков артиста — адаптер каталога (YouTube).
- Лента (`buildFeed`): «Новое от моих артистов» (релизы подписок за 90 дней, нет свежих — последние за 180) и «Свежее от похожих» (60 дней, подписки исключены). Живёт в сервисе чартов (`main/charts.ts`): то же расписание (запуск и каждые 6 ч), кэш `artist-feed.json`, события `IPC.artists.feedUpdate`; релизы подписок присылаются раньше похожих. Подписки сервис берёт из `library.json`, поэтому рендерер перед `refreshFeed` сначала сохраняет библиотеку (`useFeed`). `chartsService` экспортируется из `ipc/charts.ts`.

### Страна чарта

`main/country.ts`: `resolveCountry(настройка, страна системы)` → код страны (`chartCountry` или страна системы, неизвестная — `us`); `currentCountry()` читают чарт (`fetchCatalog({country})`), `artists.popular` и сервис артистов, `ChartsSnapshot.country` отдаёт страну рендереру. Смена страны в настройках (`ipc/settings.ts`) сразу обновляет чарт.

### Ограничитель частоты каталога

`catalogLimiter` (`catalog.ts`, `createRateLimiter`) — один на приложение, скользящее окно 60 с: 20 запросов, фону (`'background'`: лента, обновление чарта) не больше 15, остальное — запас пользователя (`'user'`: поиск, страница артиста, релиз); ждущие запросы пользователя идут раньше фоновых. Через него идут только адреса `ITUNES_BASE` (`limitedFetch` в `catalog.ts`, `fetchVia` в `artists.ts`); RSS чарта и Deezer — напрямую. Повторы запросов тоже идут через него.

### Волна

Очередь, которая сама дописывается похожими треками. Три части:

- Вкус ведёт волну: «Моя волна» на главной и чипы жанров берутся из `stores/tasteWave.ts` (нет вкуса — «Популярное сейчас» страны и нейтральные жанры); зашитых списков артистов нет.
- `main/wave.ts` (`aura.wave.start` / `more`, IPC `ipc/wave.ts`) только подбирает кандидатов: Mix YouTube для трека, треки и радио артиста из Deezer, подборки Deezer для жанра; песни отсеиваются от миксов и переделок (`isSongLike`). Это треки `catalog:dz<id>` — звук находит адаптер каталога; сам подбор требует `youtubeEnabled`. Источники чередуются по номеру раунда.
- `shared/wave.ts` — отбор у рендерера (`pickWaveTracks`): без повторов песни, без чёрного списка, один исполнитель не больше двух раз подряд. Память волны — только массивы строк.
- `renderer/stores/useWave.ts` — волна как обычная очередь `usePlayer`: дописывает, когда впереди ≤ `WAVE_REFILL_AT` (3) треков; другой список в плеере её выключает. Запуск — `WaveButton`, `WaveBlock` на главной, страница артиста, жанр.

Хук конца очереди: `useWave` ставит `setQueueEndHook` в `usePlayer`. Дошла очередь до конца — плеер зовёт хук синхронно (`waitForMore`): активная волна дописывает, а при `waveAfterQueue`, включённом YouTube и выключенном повторе запускается «похожие на последний трек». Хук может сам, внутри вызова, вызвать `appendTracks` (в том числе пустым списком) — `usePlayer` отличает это флагом `endHookRunning`.

## yt-dlp

`main/ytdlp.ts` не импортирует electron; пути и рантайм задаёт `configureYtDlp` из `main/ipc/ytdlp.ts`.

- Папочная сборка (`yt-dlp.exe` + `_internal/`) скачивается с официального GitHub в фоне при первом запуске в `userData/bin` и сверяется по SHA2-256SUMS; в установщик не вшивается. Обновление — кнопкой в настройках (`updateYtDlp`).
- Единственная точка запуска — `runYtDlp(args, signal?, {timeoutMs?, onLine?})`. Она добавляет `--ignore-config --no-cookies --no-cookies-from-browser` и отвергает до запуска любые аргументы входа, куки, netrc, сторонних конфигов и заголовков (`findForbiddenArg`, `FORBIDDEN_YTDLP_OPTIONS`, ошибка `YtDlpError('forbidden')`). Это правило G01: Aura обращается к YouTube и SoundCloud только анонимно.
- JS-рантайм для YouTube — сам Electron: `--js-runtimes node:<process.execPath>` и `ELECTRON_RUN_AS_NODE=1` в окружении дочернего процесса.

## Загрузки

`main/downloads.ts` — `createDownloadManager`: очередь, не больше двух одновременных (`MAX_CONCURRENT_DOWNLOADS`), отмена, список записей (`downloads.json`), удаление файла.

- Адаптерный `download(track, destPath, ctx, onProgress, signal)` пишет в переданный путь `*.<8 hex>.part` и возвращает итоговый путь; менеджер переименовывает по завершении. Расширение берётся из возвращённого пути, иначе из `sourceId`, иначе `mp3`. Прямая загрузка по URL — `sources/fetchFile.ts` (`fetchToFile`).
- При старте `sweepDownloadLeftovers` убирает обрывки прошлых загрузок (`LEFTOVER_PART`); при выходе `cancelAllDownloads`.
- Состояния уходят событием `aura:downloads:state` (`DownloadState`), рендерер держит их в `useDownloads`.
- Файлы на диске удаляются через `unlink` (на Windows с Node 24 `fs.rmSync` молча не удаляет файлы с не-ASCII именами).

## Протокол `aura-media://`

`main/protocol.ts`: `aura-media://file/<encodeURIComponent(абсолютный путь)>` с поддержкой Range. Отдаёт только файлы из папки скачивания, `localFolders`, кэша обложек и из записей загрузок (`mediaRoots()` в `ipc/downloads.ts`). Схема регистрируется как привилегированная до готовности приложения (`MEDIA_SCHEME_PRIVILEGES` в `main/index.ts`).

## Запуск main

`main/index.ts`: один экземпляр (`requestSingleInstanceLock`, повторный запуск поднимает окно); `setStoreDir(userData)` → `registerMediaProtocol` → `registerIpc` (в том числе запуск обновления чартов) → `registerQuitFlush` → уборка обрывков → окно. Фон окна до первой отрисовки — цвет темы из настроек, чтобы не было вспышки. Меню приложения убрано, рамка своя (`TitleBar`).

## Рендерер

Вход — `renderer/main.tsx`: до отрисовки грузятся `useSettings` и `useLibrary`. Сторы (zustand, `renderer/stores/`):

- `usePlayer` — очередь и состояние воспроизведения; единственный `<audio>` живёт в `audioEngine.ts`. Перед загрузкой трек проходит `aura.resolveStream`. Треки из `WAIT_SOURCES` (youtube, catalog, soundcloud) грузятся без таймера и без автоперескока: срыв — одна повторная попытка (`resolveStream` с `fresh`), потом тост «Повторить»; остальным — `LOAD_TIMEOUT_MS` (15 с) и переход к следующему. Конец очереди — хук `setQueueEndHook` (см. «Волна»). Громкость, mute, повтор, перемешивание и `lastSession` сохраняются в настройки.
- `useLibrary` — `LibraryData` и действия-обёртки над `shared/library.ts`, отложенное сохранение.
- `useSettings` — `Settings`, `update(patch)`, `applyTheme(theme, origin?)` (анимированная заливка кругом от точки клика, `theme/themeTransition.ts`; при системном «уменьшении анимации» — фейд).
- `useDownloads` — записи и состояния загрузок; `useUi` — текущий экран, «Назад», строка поиска, тосты.
- `tasteTracking` — события вкуса (см. «Чёрный список и вкус»); `blacklistActions` — действия и селекторы чёрного списка.
- `useWave` — волна поверх очереди плеера (чёрный список: подписка чистит память, пул и очередь; «Не нравится» скрывает только текущий трек; удаление будущих треков снаружи волну не выключает — замена очереди другим списком выключает); `useFeed` — лента артистов (снимки из main, «Обновить», пересборка после подписки).

Экраны выбираются по `ScreenName` (`stores/useUi.ts`) через реестр `app/ScreenHost.tsx`; параметр экрана — тег для `tag`, id для `playlist`, `id:<id>` или `name:<имя>` для `artist` (`screens/artist/artistNav.ts`). Есть экраны `charts`, `artist`, `album` (страница альбома, параметр — id релиза, `artistNav.ts`), `following` («Мои артисты»). Исполнитель в строках («Недавно», очередь, сетки, плеер) — ссылка `components/ArtistLinks`; переход по имени только при точном совпадении (`artistKey`), иначе остаётся текстом. Все списки треков рисует один компонент `TrackTable` (♥, «+», «Скачать», метка источника в каждой строке; `playlistId` включает перетаскивание и удаление). Запросы по источникам с повторами — `screens/search/sourceQueries.ts`; чарты — `screens/charts/useCharts.ts`; блоки ленты и волны на главной — `screens/home/` (`FeedBlocks`, `WaveBlock`).

Первый запуск: `components/Onboarding` (поверх приложения, пока `needsOnboarding`: `onboarded === false` и библиотека пуста) спрашивает «Что ты слушаешь?» (артисты страны и жанры), записывает подписки и события вкуса. Фоновая установка yt-dlp при первом запуске показывается в сайдбаре (`components/Sidebar/YtDlpStatus`). Очередь справа — `components/RightPanel/Queue` поверх `queueView.ts` (сыгранные, текущий, следующие; окно ~120 строк; у будущих «Убрать из очереди»). Меню «⋯» в строках — `components/Menu`.

Адаптивность: минимальный размер окна 1100×700 (`main/window.ts`), сайдбар сворачивается в иконки ниже 1200 px или вручную, правая колонка прячется в узком окне.

## Чистая копия для публикации

`npm run public -- --out <папка>` (`scripts/make-public.mjs`) собирает копию репозитория для GitHub: список файлов берёт из `git ls-files`, содержимое читает с диска (поэтому запускать на чистом дереве), исключает служебное (`EXCLUDED`: рабочие заметки сборки, правила агентов, записи решений), проверяет файлы на личное по локальному списку запрещённых строк (`.public-forbidden` в корне — в `.gitignore`, в копию не попадает) и по данным git-конфига, заменяет IP-адреса в образцах ответов и кладёт результат в отдельную папку со своим git и одним коммитом «Aura <версия>». Повторный запуск синхронизирует копию; `--author "Имя <почта>"` или другой автор пересоздаёт историю копии. Без `--out` пишет в `../aura-public`. Скрипт ничего не публикует. Тесты — `scripts/make-public.test.mjs`.

## Договорённости проекта

- Интерфейс полностью на русском; тексты ошибок человеческие, без стектрейсов. В интерфейсе не называем Apple, iTunes, Яндекс, Deezer.
- G01: YouTube только анонимно — никаких кук, входа, netrc; все вызовы yt-dlp только через `runYtDlp`. Нарушение — блокирующая находка ревью.
- Секреты в код и репозиторий не попадают; ключей у приложения нет — внешние API открытые, без аккаунта.
- Стили — CSS-модули или обычный CSS с переменными темы `var(--…)`; цвета не хардкодятся, кроме пресетов темы (`shared/palette.ts`).
- Иконки — `lucide-react`, шрифт — Manrope (`@fontsource/manrope`).
- Новая зависимость в main должна попасть в бандл `out/`: `node_modules` в установщик не входит (`electron-builder.yml`), ESM-only пакеты (`nanoid`, `music-metadata`) явно перечислены в `externalizeDeps.exclude` (`electron.vite.config.ts`).
- Проверка перед сдачей — `npm run check`.
