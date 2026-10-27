// Область экрана: показывает текущий экран из useUi с мягким появлением.
import type { ComponentType } from 'react';
import { AlbumScreen } from '../screens/album/AlbumScreen';
import { ArtistScreen } from '../screens/artist/ArtistScreen';
import { ChartsScreen } from '../screens/charts/ChartsScreen';
import { BrowseScreen } from '../screens/browse/BrowseScreen';
import { DownloadsScreen } from '../screens/downloads/DownloadsScreen';
import { FollowingScreen } from '../screens/following/FollowingScreen';
import { HistoryScreen } from '../screens/history/HistoryScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { LikesScreen } from '../screens/likes/LikesScreen';
import { LocalScreen } from '../screens/local/LocalScreen';
import { PlaylistScreen } from '../screens/playlist/PlaylistScreen';
import { SearchScreen } from '../screens/search/SearchScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { SoundcloudScreen } from '../screens/soundcloud/SoundcloudScreen';
import { TagScreen } from '../screens/tag/TagScreen';
import { useUi, type ScreenName } from '../stores/useUi';
import styles from './ScreenHost.module.css';

/** Реестр экранов: имя → компонент. Компонент получает `param` текущего экрана. */
const SCREENS: Record<ScreenName, ComponentType<{ param?: string }>> = {
  home: HomeScreen,
  charts: ChartsScreen,
  soundcloud: SoundcloudScreen,
  search: SearchScreen,
  browse: BrowseScreen,
  tag: TagScreen,
  playlist: PlaylistScreen,
  likes: LikesScreen,
  downloads: DownloadsScreen,
  local: LocalScreen,
  history: HistoryScreen,
  settings: SettingsScreen,
  artist: ArtistScreen,
  album: AlbumScreen,
  following: FollowingScreen,
};

export function ScreenHost() {
  const screen = useUi((s) => s.screen);
  const Current = SCREENS[screen.name];
  // key: новый экран — новый контейнер прокрутки (начинается сверху) и анимация появления.
  return (
    <div key={`${screen.name}:${screen.param ?? ''}`} className={styles.host}>
      <div className={styles.screen}>
        <Current param={screen.param} />
      </div>
    </div>
  );
}
