// Обновление Aura по вопросу (G46–G49): найденная версия, окно «Вышла Aura X.Y.Z», плашка «Позже» и ход скачивания.
// Сеть и установка — в main (`window.aura.update`); здесь только состояние интерфейса.
import { create } from 'zustand';
import type { UpdateCheck, UpdateInfo } from '../../shared/version';
import { errorMessage } from '../app/errors';

export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'installing' | 'failed';

/** Через столько после запуска — тихая проверка (запуск и первые экраны важнее). */
export const UPDATE_CHECK_DELAY_MS = 5000;

const DOWNLOAD_FAILED = 'Не удалось скачать обновление';

interface UpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  /** Доля скачанного 0..1, -1 — неизвестно. */
  progress: number;
  /** Окно-вопрос открыто. */
  dialogOpen: boolean;
  /** Плашку закрыли крестиком — до следующего запуска. */
  bannerHidden: boolean;
  /** Текст ошибки скачивания/установки (`phase: 'failed'`). */
  error: string | null;
  /** Нашлась версия новее: окно-вопрос (при запуске и по кнопке «Проверить обновления»). */
  offer(info: UpdateInfo): void;
  /** «Позже», Esc, клик мимо; во время скачивания — то же, что «Отмена». */
  later(): void;
  /** «Обновить» / «Повторить» — в окне или в плашке: скачать, проверить и установить. */
  update(): Promise<void>;
  hideBanner(): void;
}

/** Отмену нажали мы сами — её ошибка скачивания не «сбой». */
let cancelled = false;

export const useUpdate = create<UpdateState>((set, get) => ({
  phase: 'idle',
  info: null,
  progress: 0,
  dialogOpen: false,
  bannerHidden: false,
  error: null,

  offer(info) {
    const { phase } = get();
    if (phase === 'downloading' || phase === 'installing') {
      set({ dialogOpen: true });
      return;
    }
    set({ phase: 'available', info, dialogOpen: true, error: null, progress: 0 });
  },

  later() {
    const { phase } = get();
    if (phase === 'installing') return;
    if (phase === 'downloading') {
      cancelled = true;
      void window.aura.update.cancel().catch(() => undefined);
      set({ phase: 'available', progress: 0 });
    }
    if (phase === 'failed') set({ phase: 'available', error: null });
    set({ dialogOpen: false });
  },

  async update() {
    const { phase, info } = get();
    if (!info || phase === 'downloading' || phase === 'installing') return;
    cancelled = false;
    set({ phase: 'downloading', progress: 0, error: null });
    try {
      await window.aura.update.download();
    } catch (err) {
      if (cancelled) return;
      set({ phase: 'failed', error: errorMessage(err, DOWNLOAD_FAILED) });
      return;
    }
    if (cancelled || get().phase !== 'downloading') return;
    set({ phase: 'installing', progress: 1 });
    try {
      // Main запускает установщик и выходит обычным путём (библиотека и настройки дописываются при закрытии).
      await window.aura.update.install();
    } catch (err) {
      set({ phase: 'failed', error: errorMessage(err, 'Не удалось установить обновление') });
    }
  },

  hideBanner() {
    set({ bannerHidden: true });
  },
}));

/** Плашка «Вышла версия X.Y.Z» над содержимым: после «Позже», до крестика. */
export const useUpdateBannerShown = (): boolean => useUpdate((s) => s.phase !== 'idle' && !s.dialogOpen && !s.bannerHidden);

/** Проверка кнопкой: нашлось — сразу окно-вопрос. */
export async function checkForUpdatesNow(): Promise<UpdateCheck> {
  let res: UpdateCheck;
  try {
    res = await window.aura.update.check(true);
  } catch {
    res = { kind: 'error', offline: false };
  }
  if (res.kind === 'available') useUpdate.getState().offer(res.info);
  return res;
}

let started = false;

/** Один раз за запуск: подписка на ход скачивания и тихая проверка через ~5 с. Ошибки молчат. */
export function startUpdateCheck(): void {
  if (started) return;
  started = true;
  window.aura.update.onProgress((fraction) => {
    if (useUpdate.getState().phase === 'downloading') useUpdate.setState({ progress: fraction });
  });
  setTimeout(() => {
    void window.aura.update
      .check(false)
      .then((res) => {
        if (res.kind === 'available') useUpdate.getState().offer(res.info);
      })
      .catch(() => undefined);
  }, UPDATE_CHECK_DELAY_MS);
}
