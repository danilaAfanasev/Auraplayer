// Блоки ленты артистов: «Новое от моих артистов» и «Свежее от похожих» (главная и «Мои артисты»).
import { ChevronRight, LoaderCircle, RefreshCw, Sparkles, UserRoundCheck, WifiOff, type LucideIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { timeAgo } from '../../../shared/format';
import { Button, IconButton } from '../../components/Button/Button';
import { useNow } from '../../components/useNow';
import { useBlacklist } from '../../stores/blacklistActions';
import { useFeed, useFeedInit } from '../../stores/useFeed';
import { useLibrary } from '../../stores/useLibrary';
import { useUi, type ScreenName } from '../../stores/useUi';
import { ReleaseGrid } from '../artist/ReleaseGrid';
import styles from './CatalogBlocks.module.css';
import feedStyles from './FeedBlocks.module.css';
import { feedBlockState, isFeedOutdated, visibleFeed, type FeedBlockState, type FeedView } from './feedView';

/** Лента без отписанных и без чёрного списка (до пересборки в main): скрыл — пропадает сразу, пока главная открыта. */
export function useFeedView(): FeedView {
  const followed = useFeed((s) => s.followed);
  const similar = useFeed((s) => s.similar);
  const artists = useLibrary((s) => s.lib.followedArtists);
  const bl = useBlacklist();
  return useMemo(() => visibleFeed({ followed, similar }, artists.map((a) => a.id), bl), [followed, similar, artists, bl]);
}

/** «Обновлено N мин назад» · «Нет соединения» · «Обновить». */
export function FeedStatus() {
  const updatedAt = useFeed((s) => s.updatedAt);
  const refreshing = useFeed((s) => s.refreshing);
  const error = useFeed((s) => s.error);
  const refresh = useFeed((s) => s.refresh);
  const now = useNow();
  return (
    <div className={feedStyles.status}>
      {error && !refreshing && (
        <span className={feedStyles.offline} role="status" title={error.message}>
          <WifiOff size={13} strokeWidth={2.4} />
          {error.kind === 'offline' ? 'Нет соединения' : 'Не обновилось'}
        </span>
      )}
      <span className={feedStyles.updated}>
        {refreshing ? (
          <>
            <LoaderCircle size={13} className="spin" /> Обновляется…
          </>
        ) : updatedAt ? (
          `Обновлено ${timeAgo(updatedAt, Math.max(now, updatedAt))}`
        ) : null}
      </span>
      <IconButton icon={RefreshCw} size="small" label="Обновить" title="Обновить" disabled={refreshing} onClick={() => void refresh()} />
    </div>
  );
}

function BlockHeader({ icon: Icon, title, subtitle, target, aside }: { icon: LucideIcon; title: string; subtitle: string; target?: ScreenName; aside?: ReactNode }) {
  const navigate = useUi((s) => s.navigate);
  return (
    <header className={styles.header}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={22} strokeWidth={2.2} />
      </span>
      <div className={styles.heading}>
        {target ? (
          <button type="button" className={styles.title} onClick={() => navigate({ name: target })}>
            {title}
            <ChevronRight size={20} strokeWidth={2.6} />
          </button>
        ) : (
          <h2 className={styles.title}>{title}</h2>
        )}
        <div className={styles.subtitle}>{subtitle}</div>
      </div>
      {aside && <div className={styles.aside}>{aside}</div>}
    </header>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className={styles.notice} role="status">
      {children}
    </div>
  );
}

function SkeletonCards() {
  return (
    <Placeholder>
      <LoaderCircle size={18} className="spin" />
      <span>Собираю свежие релизы…</span>
    </Placeholder>
  );
}

/** Состояние блока ленты: сбой и лента по старым подпискам — не «ничего не выходило». */
function useFeedBlockState(count: number): FeedBlockState {
  const loading = useFeed((s) => s.loading);
  const refreshing = useFeed((s) => s.refreshing);
  const error = useFeed((s) => s.error);
  const builtFor = useFeed((s) => s.followedIds);
  const artists = useLibrary((s) => s.lib.followedArtists);
  const outdated = useMemo(() => isFeedOutdated(builtFor, artists.map((a) => a.id)), [builtFor, artists]);
  return feedBlockState({ count, loading, refreshing, error, outdated });
}

/** «Собираю…», «Нет соединения» или «Не удалось обновить ленту» — с «Повторить». */
function FeedNotice({ state }: { state: Exclude<FeedBlockState, 'items' | 'empty'> }) {
  const refresh = useFeed((s) => s.refresh);
  const message = useFeed((s) => s.error?.message);
  if (state === 'loading') return <SkeletonCards />;
  return (
    <Placeholder>
      <WifiOff size={18} />
      <span title={message}>
        {state === 'offline' ? 'Нет соединения — лента обновится, когда вернётся интернет' : 'Не удалось обновить ленту'}
      </span>
      <Button variant="outline" icon={RefreshCw} onClick={() => void refresh()}>
        Повторить
      </Button>
    </Placeholder>
  );
}

/** «Новое от моих артистов»: релизы подписок за ~90 дней, новые сверху. */export function FollowedFeedBlock({ limit, linkTitle = true }: { limit?: number; linkTitle?: boolean }) {
  useFeedInit();
  const { followed } = useFeedView();
  const items = limit ? followed.slice(0, limit) : followed;
  const state = useFeedBlockState(items.length);

  return (
    <section className={styles.block}>
      <BlockHeader
        icon={UserRoundCheck}
        title="Новое от моих артистов"
        subtitle="Свежие релизы подписок за последние три месяца"
        target={linkTitle ? 'following' : undefined}
        aside={<FeedStatus />}
      />
      {state === 'items' ? (
        <ReleaseGrid releases={items} />
      ) : state === 'empty' ? (
        <Placeholder>
          <span>У твоих артистов за последние месяцы ничего не выходило — загляни позже или подпишись на кого-нибудь ещё.</span>
        </Placeholder>
      ) : (
        <FeedNotice state={state} />
      )}
    </section>
  );
}

/** «Свежее от похожих»: релизы за ~60 дней артистов, похожих на подписки (сами подписки исключены). */
export function SimilarFeedBlock({ limit }: { limit?: number }) {
  useFeedInit();
  const { similar } = useFeedView();
  const items = limit ? similar.slice(0, limit) : similar;
  const state = useFeedBlockState(items.length);
  // Пусто без сбоя — блока нет (у похожих правда ничего свежего); сбой и сборка — видны.
  if (state === 'empty') return null;

  return (
    <section className={styles.block}>
      <BlockHeader icon={Sparkles} title="Свежее от похожих" subtitle="Новые релизы артистов того же круга за последние два месяца" />
      {state === 'items' ? <ReleaseGrid releases={items} /> : <FeedNotice state={state} />}
    </section>
  );
}
