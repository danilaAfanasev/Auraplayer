// Страница альбома (EP, сингла): обложка, вид и название, исполнители ссылками, год, число треков и длительность;
// «Слушать», «Перемешать», «В плейлист», «Скачать альбом», сердечко «Сохранить альбом»; трек-лист по порядку. Скрытые треки — приглушены.
import { ChevronLeft, CircleAlert, Disc3, Download, ListPlus, Play, RotateCw, Search, Shuffle, WifiOff } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { isBlocked } from '../../../shared/blacklist';
import { formatTotalDuration, formatTrackCount } from '../../../shared/format';
import type { AlbumPage, Track } from '../../../shared/types';
import { AddToPlaylistMenu } from '../../components/AddToPlaylistMenu/AddToPlaylistMenu';
import { AlbumLikeButton } from '../../components/AlbumLikeButton/AlbumLikeButton';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { Button, IconButton } from '../../components/Button/Button';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { Skeleton, SkeletonRows } from '../../components/Skeleton/Skeleton';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { useLibrary } from '../../stores/useLibrary';
import { initDownloads, useDownloads } from '../../stores/useDownloads';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';
import { useAlbumPages } from '../artist/artistData';
import { releaseKindLabel } from '../artist/releaseFormat';
import styles from './AlbumScreen.module.css';

function play(page: AlbumPage, start: number): void {
  if (page.tracks.length > 0) usePlayer.getState().playList(page.tracks, start, page.release.title);
}

function playShuffled(page: AlbumPage): void {
  if (page.tracks.length === 0) return;
  if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
  play(page, Math.floor(Math.random() * page.tracks.length));
}

/** «Скачать альбом»: все треки, которых ещё нет на диске и в очереди загрузок (кроме скрытых), — обычными загрузками. */
function downloadAll(page: AlbumPage): void {
  const { records, states, start } = useDownloads.getState();
  const bl = useLibrary.getState().lib.blacklist;
  const todo = page.tracks.filter((t: Track) => t.downloadable && !records[t.id] && !states[t.id] && !isBlocked(t, bl));
  const { toast } = useUi.getState();
  if (todo.length === 0) {
    toast(`«${page.release.title}» уже скачан или скачивается`);
    return;
  }
  for (const t of todo) start(t);
  toast(`Скачиваю ${formatTrackCount(todo.length)} из «${page.release.title}»`);
}

function Header({ page }: { page: AlbumPage }) {
  const { release, tracks, durationSec } = page;
  const year = /^(\d{4})/.exec(release.releaseDate)?.[1];
  const meta = [year, formatTrackCount(tracks.length), durationSec > 0 && formatTotalDuration(durationSec)].filter(Boolean).join(' · ');
  const empty = tracks.length === 0;

  return (
    <section className={styles.hero} aria-label={`${release.title} — ${release.artist}`}>
      {release.coverUrl && <img className={styles.blur} src={release.coverUrl} alt="" aria-hidden="true" draggable={false} />}
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.cover}>
        {release.coverUrl ? <img src={release.coverUrl} alt="" draggable={false} /> : <Disc3 size={72} strokeWidth={1.3} />}
      </div>
      <div className={styles.body}>
        <div className={styles.eyebrow}>{releaseKindLabel(release.kind)}</div>
        <h1 className={styles.title} title={release.title}>
          {release.title}
        </h1>
        <ArtistLinks artist={release.artist} className={styles.artist} />
        <div className={styles.meta}>{meta}</div>
        <div className={styles.actions}>
          <Button icon={Play} disabled={empty} onClick={() => play(page, 0)}>
            Слушать
          </Button>
          <Button variant="outline" icon={Shuffle} disabled={empty} onClick={() => playShuffled(page)}>
            Перемешать
          </Button>
          <AddToPlaylistMenu
            tracks={tracks}
            renderTrigger={({ open, toggle }) => (
              <Button variant="outline" icon={ListPlus} aria-haspopup="menu" aria-expanded={open} disabled={empty} onClick={toggle}>
                В плейлист
              </Button>
            )}
          />
          <Button variant="outline" icon={Download} disabled={empty} onClick={() => downloadAll(page)}>
            Скачать альбом
          </Button>
          <AlbumLikeButton release={release} size="large" />
        </div>
      </div>
    </section>
  );
}

function Loading() {
  return (
    <>
      <section className={[styles.hero, styles.heroLoading].join(' ')} aria-label="Загрузка альбома">
        <Skeleton width={220} height={220} radius={18} />
        <div className={styles.body}>
          <Skeleton width={90} height={12} />
          <Skeleton width="55%" height={40} radius={12} />
          <Skeleton width={180} height={14} />
          <div className={styles.actions}>
            <Skeleton width={130} height={44} radius={999} />
            <Skeleton width={150} height={44} radius={999} />
          </div>
        </div>
      </section>
      <SkeletonRows count={8} />
    </>
  );
}

function Content({ page }: { page: AlbumPage }) {
  return (
    <>
      <Header page={page} />
      {page.tracks.length === 0 ? (
        <EmptyState icon={Disc3} title="Треков нет" text="В каталоге у этого релиза пока нет треков." />
      ) : (
        <TrackTable tracks={page.tracks} onPlay={(i) => play(page, i)} showSource={false} />
      )}
    </>
  );
}

export function AlbumScreen({ param }: { param?: string }) {
  const id = param && /^\d+$/.test(param) ? param : '';
  const entry = useAlbumPages((s) => (id ? s.entries[id] : undefined));
  const back = useUi((s) => s.back);
  const navigate = useUi((s) => s.navigate);

  useEffect(() => {
    initDownloads();
    if (id) useAlbumPages.getState().ensure(id, id);
  }, [id]);

  let body: ReactNode;
  if (!id) {
    body = <EmptyState icon={Search} title="Альбом не найден" action={{ label: 'К поиску', icon: Search, onClick: () => navigate({ name: 'search' }) }} />;
  } else if (!entry || entry.status === 'loading') {
    body = <Loading />;
  } else if (entry.status === 'error') {
    body = (
      <EmptyState
        icon={entry.offline ? WifiOff : CircleAlert}
        title={entry.offline ? 'Нет соединения' : 'Не удалось открыть альбом'}
        text={entry.offline ? 'Страница альбома появится, когда вернётся интернет.' : entry.message}
        action={{ label: 'Повторить', icon: RotateCw, onClick: () => useAlbumPages.getState().retry(id, id) }}
      />
    );
  } else {
    body = <Content page={entry.value} />;
  }

  return (
    <>
      <IconButton icon={ChevronLeft} label="Назад" className={styles.back} onClick={back} />
      {body}
    </>
  );
}
