import { useEffect } from 'react';
import { LyricsOverlay } from '../components/Lyrics/LyricsOverlay';
import { Onboarding } from '../components/Onboarding/Onboarding';
import { needsOnboarding } from '../components/Onboarding/onboardingFlow';
import { PlayerBar } from '../components/PlayerBar/PlayerBar';
import { RightPanel } from '../components/RightPanel/RightPanel';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { Soundwave } from '../components/Soundwave/Soundwave';
import { useSidebarCollapsed } from '../components/Sidebar/useSidebar';
import { TitleBar } from '../components/TitleBar/TitleBar';
import { Toasts } from '../components/Toast/Toast';
import { TrackMenuHost } from '../components/TrackMenu/TrackMenu';
import { UpdateBanner } from '../components/Update/UpdateBanner';
import { UpdateDialog } from '../components/Update/UpdateDialog';
import { initHistoryTracking } from '../screens/history/historyTracking';
import { initTasteTracking } from '../stores/tasteTracking';
import { useLibrary } from '../stores/useLibrary';
import { useLyrics } from '../stores/useLyrics';
import { useSettings } from '../stores/useSettings';
import { startUpdateCheck, useUpdateBannerShown } from '../stores/useUpdate';
import styles from './App.module.css';
import { ScreenHost } from './ScreenHost';

/**
 * Каркас окна: мягкий градиентный фон темы и стеклянная карточка с тремя колонками —
 * сайдбар | экран + панель плеера | правая колонка. Уже 1280 px правая колонка скрыта,
 * уже 1200 px сайдбар сворачивается в иконки (или по кнопке-шеврону на его краю).
 * За карточкой — саундвейв (холст во всё окно), пока он включён в «Оформлении».
 * Новый пользователь (пустая библиотека, первый запуск не пройден) сначала видит поверх «Что ты слушаешь?».
 */
export function App() {
  const collapsed = useSidebarCollapsed();
  const settings = useSettings((s) => s.settings);
  const lib = useLibrary((s) => s.lib);
  const onboarding = needsOnboarding(settings, lib);
  const updateBanner = useUpdateBannerShown();
  const lyricsOpen = useLyrics((s) => s.open);
  // Трек попадает в историю после 10 секунд звучания; дослушал/пропустил/лайк/подписка — во вкус.
  useEffect(() => {
    initHistoryTracking();
    initTasteTracking();
    // Через ~5 с после запуска — тихая проверка новой версии (окно-вопрос, если нашлась).
    startUpdateCheck();
  }, []);
  return (
    <div className={styles.window} data-lyrics={lyricsOpen ? 'open' : undefined}>
      <div className={styles.backdrop} aria-hidden="true" />
      {/* Пока открыт текст, волну рисует его слой (поверх непрозрачной подложки) — второй холст не нужен. */}
      {settings.soundwave && !lyricsOpen && <Soundwave />}
      <div className={styles.card} data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <TitleBar />
        <Sidebar />
        <main className={styles.main} data-update-banner={updateBanner ? 'shown' : undefined}>
          <UpdateBanner />
          <ScreenHost />
          <PlayerBar />
          <Toasts />
        </main>
        <TrackMenuHost />
        <div className={styles.right}>
          <RightPanel />
        </div>
        {onboarding && <Onboarding />}
      </div>
      <LyricsOverlay />
      <UpdateDialog />
    </div>
  );
}
