// «Альбомы»: сохранённые альбомы библиотеки, новые первыми. Лайк альбома не лайкает его треки.
import { Disc3, Search } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { useBlacklist } from '../../stores/blacklistActions';
import { useLibrary } from '../../stores/useLibrary';
import { useUi } from '../../stores/useUi';
import { ReleaseGrid } from '../artist/ReleaseGrid';
import { albumsCountLabel, visibleAlbums } from './albumsView';

export function AlbumsScreen() {
  const navigate = useUi((s) => s.navigate);
  const liked = useLibrary((s) => s.lib.likedAlbums);
  const bl = useBlacklist();
  const releases = useMemo(() => visibleAlbums(liked, bl), [liked, bl]);
  const count = releases.length;

  return (
    <>
      <ScreenHeader eyebrow={count > 0 ? `Библиотека · ${albumsCountLabel(count)}` : 'Библиотека'} title="Альбомы" />
      {count === 0 ? (
        <EmptyState
          icon={Disc3}
          title="Здесь пока пусто"
          text="Здесь будут альбомы, которые ты сохранишь — нажми ♡ на странице альбома."
          action={{ label: 'Найти музыку', icon: Search, onClick: () => navigate({ name: 'search' }) }}
        />
      ) : (
        <ReleaseGrid releases={releases} />
      )}
    </>
  );
}
