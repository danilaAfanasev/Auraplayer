import {
  ChevronLeft,
  Cloud,
  Compass,
  Download,
  FolderOpen,
  Heart,
  History,
  House,
  ListMusic,
  Plus,
  Search,
  Settings,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLibrary } from '../../stores/useLibrary';
import { sameScreen, useUi, type Screen } from '../../stores/useUi';
import { AuraLogo } from '../AuraLogo/AuraLogo';
import styles from './Sidebar.module.css';
import { useSidebar, useSidebarCollapsed } from './useSidebar';
import { YtDlpStatus } from './YtDlpStatus';

const SEARCH_INPUT_ID = 'aura-sidebar-search';

/** Фокус в поле поиска; в свёрнутом сайдбаре сначала раскрывает его. */
function focusSearch(): void {
  useSidebar.getState().expand();
  requestAnimationFrame(() => {
    const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  });
}

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  target: Screen;
  /** Экран тоже считается «этим пунктом» (например, жанр — часть «Обзора»). */
  alsoActiveFor?: Screen['name'][];
}

function NavItem({ icon: Icon, label, target, alsoActiveFor = [] }: NavItemProps) {
  const screen = useUi((s) => s.screen);
  const navigate = useUi((s) => s.navigate);
  const active = sameScreen(screen, target) || alsoActiveFor.includes(screen.name);
  return (
    <button
      type="button"
      className={[styles.item, active ? styles.active : ''].join(' ')}
      aria-current={active ? 'page' : undefined}
      title={label}
      onClick={() => navigate(target)}
    >
      <Icon size={20} strokeWidth={active ? 2.3 : 2} className={styles.itemIcon} />
      <span className={styles.label}>{label}</span>
    </button>
  );
}

function SearchField() {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  const navigate = useUi((s) => s.navigate);

  // Ctrl+F / Ctrl+K — к поиску.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k' || e.key === 'а' || e.key === 'л')) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <label className={styles.search}>
      <Search size={17} className={styles.searchIcon} />
      <input
        id={SEARCH_INPUT_ID}
        type="text"
        value={query}
        placeholder="Поиск музыки"
        aria-label="Поиск музыки"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim() && navigate({ name: 'search' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate({ name: 'search' });
          if (e.key === 'Escape') {
            setQuery('');
            e.currentTarget.blur();
          }
        }}
      />
      {query && (
        <button type="button" className={styles.clear} aria-label="Очистить поиск" onClick={() => setQuery('')}>
          <X size={14} />
        </button>
      )}
    </label>
  );
}

function Playlists() {
  const playlists = useLibrary((s) => s.lib.playlists);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const navigate = useUi((s) => s.navigate);
  const collapsed = useSidebarCollapsed();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // Enter и последующая потеря фокуса не должны создать плейлист дважды.
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit && name.trim()) {
      const playlist = createPlaylist(name);
      navigate({ name: 'playlist', param: playlist.id });
    }
    setName('');
    setCreating(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };

  return (
    <>
      {creating ? (
        <div className={styles.createField}>
          <ListMusic size={18} className={styles.itemIcon} />
          <input
            autoFocus
            value={name}
            maxLength={80}
            placeholder="Название плейлиста"
            aria-label="Название нового плейлиста"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => finish(true)}
          />
        </div>
      ) : (
        <button
          type="button"
          className={[styles.item, styles.create].join(' ')}
          title="Создать плейлист"
          onClick={() => {
            // В свёрнутом сайдбаре поля имени не видно — раскрываем его.
            if (collapsed) useSidebar.getState().expand();
            finished.current = false;
            setCreating(true);
          }}
        >
          <span className={styles.plus}>
            <Plus size={16} strokeWidth={2.4} />
          </span>
          <span className={styles.label}>Создать плейлист</span>
        </button>
      )}
      {playlists.map((p) => (
        <NavItem key={p.id} icon={ListMusic} label={p.name} target={{ name: 'playlist', param: p.id }} />
      ))}
    </>
  );
}

/** Левая колонка: логотип, поиск, меню, библиотека, плейлисты, настройки. */
export function Sidebar() {
  const collapsed = useSidebarCollapsed();
  const toggle = useSidebar((s) => s.toggle);
  return (
    <aside className={[styles.sidebar, collapsed ? styles.collapsed : ''].join(' ')}>
      <button
        type="button"
        className={styles.toggle}
        aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <ChevronLeft size={16} strokeWidth={2.4} />
      </button>
      <div className={styles.logo}>
        <span className={styles.logoFull}>
          <AuraLogo />
        </span>
        <span className={styles.logoMini}>
          <AuraLogo withWordmark={false} />
        </span>
      </div>
      <SearchField />
      <button type="button" className={styles.searchMini} aria-label="Поиск музыки" title="Поиск музыки (Ctrl+K)" onClick={focusSearch}>
        <Search size={19} />
      </button>

      <nav className={styles.scroll} aria-label="Разделы">
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Меню</div>
          <NavItem icon={House} label="Главная" target={{ name: 'home' }} />
          <NavItem icon={TrendingUp} label="Популярное сейчас" target={{ name: 'charts' }} />
          <NavItem icon={Cloud} label="SoundCloud" target={{ name: 'soundcloud' }} />
          <NavItem icon={Search} label="Поиск" target={{ name: 'search' }} />
          <NavItem icon={Compass} label="Обзор" target={{ name: 'browse' }} alsoActiveFor={['tag']} />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Библиотека</div>
          <NavItem icon={Heart} label="Мне нравится" target={{ name: 'likes' }} />
          <NavItem icon={Users} label="Мои артисты" target={{ name: 'following' }} />
          <NavItem icon={Download} label="Скачанное" target={{ name: 'downloads' }} />
          <NavItem icon={FolderOpen} label="Мои файлы" target={{ name: 'local' }} />
          <NavItem icon={History} label="История" target={{ name: 'history' }} />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Плейлисты</div>
          <Playlists />
        </div>
      </nav>

      <YtDlpStatus collapsed={collapsed} />
      <div className={styles.footer}>
        <NavItem icon={Settings} label="Настройки" target={{ name: 'settings' }} />
      </div>
    </aside>
  );
}
