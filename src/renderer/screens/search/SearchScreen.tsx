import { LoaderCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GENRES } from '../../../shared/genres';
import { SOURCE_IDS, SOURCE_NAMES, type SourceId } from '../../../shared/types';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { genreIcon } from '../../components/GenreIcon/genreIcon';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import styles from './SearchScreen.module.css';
import { ArtistResults } from './ArtistResults';
import { useSearchQueries, type SourceStatus } from './sourceQueries';
import { SourceSection } from './SourceSection';

/** Пауза после остановки ввода перед поиском. */
export const SEARCH_DEBOUNCE_MS = 400;
/** Сколько треков источника показывать во вкладке «Все». */
const ALL_TAB_LIMIT = 5;

type Tab = 'all' | SourceId;
let rememberedTab: Tab = 'all';

/** Поисковая строка после паузы в наборе. */
function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function TabCount({ status }: { status: SourceStatus | undefined }) {
  if (!status || status.status === 'loading') return <LoaderCircle size={12} className="spin" />;
  if (status.result.error) return <span className={styles.tabWarn}>!</span>;
  return <span className={styles.tabCount}>{status.result.tracks.length}</span>;
}

function GenreSuggestions() {
  const navigate = useUi((s) => s.navigate);
  return (
    <div className={styles.suggest}>
      <div className={styles.suggestTitle}>Или выбери жанр</div>
      <div className={styles.chips}>
        {GENRES.slice(0, 10).map((g) => {
          const Icon = genreIcon(g.tag);
          return (
            <button key={g.tag} type="button" className={styles.chip} onClick={() => navigate({ name: 'tag', param: g.tag })}>
              <Icon size={15} />
              {g.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Поиск по всем источникам сразу: вкладки «Все / Internet Archive / YouTube / SoundCloud / Мои файлы / Каталог» со счётчиками. */
export function SearchScreen() {
  const rawQuery = useUi((s) => s.query);
  const youtubeEnabled = useSettings((s) => s.settings.youtubeEnabled);
  const soundcloudEnabled = useSettings((s) => s.settings.soundcloudEnabled);
  const query = useDebounced(rawQuery.trim(), SEARCH_DEBOUNCE_MS);
  const entry = useSearchQueries((s) => s.entries[query]);
  const [tab, setTabState] = useState<Tab>(rememberedTab);

  const sources = useMemo(
    () => SOURCE_IDS.filter((id) => (id !== 'youtube' || youtubeEnabled) && (id !== 'soundcloud' || soundcloudEnabled)),
    [youtubeEnabled, soundcloudEnabled],
  );
  const activeTab: Tab = tab !== 'all' && !sources.includes(tab) ? 'all' : tab;
  const setTab = (t: Tab) => {
    rememberedTab = t;
    setTabState(t);
  };

  useEffect(() => {
    if (query) useSearchQueries.getState().ensure(query, sources, true);
  }, [query, sources]);

  if (!rawQuery.trim()) {
    return (
      <>
        <ScreenHeader eyebrow={sources.map((s) => SOURCE_NAMES[s]).join(' · ')} title="Поиск" />
        <EmptyState
          icon={Search}
          title="Что послушаем?"
          text="Набери название трека или исполнителя в поле слева — Aura поищет во всех источниках сразу."
        />
        <GenreSuggestions />
      </>
    );
  }

  const retry = (source: SourceId) => useSearchQueries.getState().retry(query, source);
  const total = sources.reduce((n, s) => {
    const st = entry?.[s];
    return n + (st?.status === 'done' ? st.result.tracks.length : 0);
  }, 0);
  const anyLoading = !entry || sources.some((s) => !entry[s] || entry[s]?.status === 'loading');
  const emptyText = `По запросу «${query || rawQuery.trim()}» ничего не нашлось`;
  const queueTitle = `Поиск: «${query}»`;

  return (
    <>
      <ScreenHeader eyebrow={`По запросу «${rawQuery.trim()}»`} title="Поиск" />

      <ArtistResults query={query} />

      <div className={styles.tabs} role="tablist" aria-label="Источники">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          className={[styles.tab, activeTab === 'all' ? styles.tabActive : ''].join(' ')}
          onClick={() => setTab('all')}
        >
          Все
          {anyLoading ? <LoaderCircle size={12} className="spin" /> : <span className={styles.tabCount}>{total}</span>}
        </button>
        {sources.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={activeTab === s}
            className={[styles.tab, activeTab === s ? styles.tabActive : ''].join(' ')}
            onClick={() => setTab(s)}
          >
            {SOURCE_NAMES[s]}
            <TabCount status={entry?.[s]} />
          </button>
        ))}
      </div>

      {activeTab === 'all' ? (
        <div key={`all:${query}`}>
          {sources.map((s) => (
            <SourceSection
              key={s}
              source={s}
              status={entry?.[s]}
              emptyText={emptyText}
              onRetry={() => retry(s)}
              limit={ALL_TAB_LIMIT}
              withTitle
              onShowAll={() => setTab(s)}
              queueTitle={queueTitle}
            />
          ))}
        </div>
      ) : (
        <SourceSection
          key={`${activeTab}:${query}`}
          source={activeTab}
          status={entry?.[activeTab]}
          emptyText={emptyText}
          onRetry={() => retry(activeTab)}
          queueTitle={queueTitle}
        />
      )}
    </>
  );
}
