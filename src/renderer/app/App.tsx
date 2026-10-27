import { useEffect } from 'react';
import { Onboarding } from '../components/Onboarding/Onboarding';
import { needsOnboarding } from '../components/Onboarding/onboardingFlow';
import { PlayerBar } from '../components/PlayerBar/PlayerBar';
import { RightPanel } from '../components/RightPanel/RightPanel';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { useSidebarCollapsed } from '../components/Sidebar/useSidebar';
import { TitleBar } from '../components/TitleBar/TitleBar';
import { Toasts } from '../components/Toast/Toast';
import { TrackMenuHost } from '../components/TrackMenu/TrackMenu';
import { initHistoryTracking } from '../screens/history/historyTracking';
import { initTasteTracking } from '../stores/tasteTracking';
import { useLibrary } from '../stores/useLibrary';
import { useSettings } from '../stores/useSettings';
import styles from './App.module.css';
import { ScreenHost } from './ScreenHost';

/**
 * Каркас окна: мягкий градиентный фон темы и стеклянная карточка с тремя колонками —
 * сайдбар | экран + панель плеера | правая колонка. Уже 1280 px правая колонка скрыта,
 * уже 1200 px сайдбар сворачивается в иконки (или по кнопке-шеврону на его краю).
 * Новый пользователь (пустая библиотека, первый запуск не пройден) сначала видит поверх «Что ты слушаешь?».
 */
export function App() {
  const collapsed = useSidebarCollapsed();
  const settings = useSettings((s) => s.settings);
  const lib = useLibrary((s) => s.lib);
  const onboarding = needsOnboarding(settings, lib);
  // Трек попадает в историю после 10 секунд звучания; дослушал/пропустил/лайк/подписка — во вкус.
  useEffect(() => {
    initHistoryTracking();
    initTasteTracking();
  }, []);
  return (
    <div className={styles.window}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.card} data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <TitleBar />
        <Sidebar />
        <main className={styles.main}>
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
    </div>
  );
}
