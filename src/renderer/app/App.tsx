import { useEffect, useRef, useState, type RefObject } from 'react';
import { LyricsOverlay, type LyricsPhase } from '../components/Lyrics/LyricsOverlay';
import { Onboarding } from '../components/Onboarding/Onboarding';
import { needsOnboarding } from '../components/Onboarding/onboardingFlow';
import { PLAYER_BAR_ATTR, PlayerBar } from '../components/PlayerBar/PlayerBar';
import { RightPanel } from '../components/RightPanel/RightPanel';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { Soundwave, type SoundwaveCenter } from '../components/Soundwave/Soundwave';
import { useSidebarCollapsed } from '../components/Sidebar/useSidebar';
import { TitleBar } from '../components/TitleBar/TitleBar';
import { Toasts } from '../components/Toast/Toast';
import { TrackMenuHost } from '../components/TrackMenu/TrackMenu';
import { UpdateBanner } from '../components/Update/UpdateBanner';
import { UpdateDialog } from '../components/Update/UpdateDialog';
import { initHistoryTracking } from '../screens/history/historyTracking';
import { initTasteTracking } from '../stores/tasteTracking';
import { useLibrary } from '../stores/useLibrary';
import { useSettings } from '../stores/useSettings';
import { startUpdateCheck, useUpdateBannerShown } from '../stores/useUpdate';
import styles from './App.module.css';
import { ScreenHost } from './ScreenHost';

/**
 * Центр области содержимого — экран над панелью плеера, между сайдбаром и правой колонкой: там стоит «Кольцо».
 * Следит, только пока `enabled` (выбран вид «Кольцо»).
 */
function useContentCenter(mainRef: RefObject<HTMLElement | null>, enabled: boolean): SoundwaveCenter | null {
  const [center, setCenter] = useState<SoundwaveCenter | null>(null);
  useEffect(() => {
    const main = mainRef.current;
    if (!enabled || !main) {
      setCenter(null);
      return;
    }
    const measure = (): void => {
      const box = main.getBoundingClientRect();
      const bar = main.querySelector(`[${PLAYER_BAR_ATTR}]`)?.getBoundingClientRect();
      const bottom = bar && bar.top > box.top ? bar.top : box.bottom;
      const next = { x: Math.round(box.left + box.width / 2), y: Math.round((box.top + bottom) / 2) };
      setCenter((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [mainRef, enabled]);
  return center;
}

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
  // Слой текста на экране (открыт, раскрывается или сворачивается) и его фаза.
  const [lyricsPhase, setLyricsPhase] = useState<LyricsPhase | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const ringCenter = useContentCenter(mainRef, settings.soundwave && settings.soundwaveStyle === 'ring');
  // Трек попадает в историю после 10 секунд звучания; дослушал/пропустил/лайк/подписка — во вкус.
  useEffect(() => {
    initHistoryTracking();
    initTasteTracking();
    // Через ~5 с после запуска — тихая проверка новой версии (окно-вопрос, если нашлась).
    startUpdateCheck();
  }, []);
  return (
    <div className={styles.window} data-lyrics={lyricsPhase ? 'open' : undefined}>
      <div className={styles.backdrop} aria-hidden="true" />
      {/* Пока текст открыт целиком, волну рисует его слой (поверх непрозрачной подложки) — второй холст не нужен;
          пока слой раскрывается или сворачивается кругом, вокруг круга видно окно — с волной. */}
      {settings.soundwave && lyricsPhase !== 'open' && <Soundwave center={ringCenter} />}
      <div className={styles.card} data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <TitleBar />
        <Sidebar />
        <main ref={mainRef} className={styles.main} data-update-banner={updateBanner ? 'shown' : undefined}>
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
      <LyricsOverlay onPhaseChange={setLyricsPhase} />
      <UpdateDialog />
    </div>
  );
}
