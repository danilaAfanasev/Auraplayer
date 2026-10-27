// Страница артиста: шапка с фото и «Подписаться», популярные треки, «Альбомы» (с EP) и «Синглы» от новых к старым,
// похожие артисты.
// Звук любого трека — через адаптер каталога (YouTube).
import { AudioWaveform, Ban, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Play, RotateCw, Search, Undo2, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { artistKey } from '../../../shared/artistNames';
import { isArtistBlocked } from '../../../shared/blacklist';
import { formatTrackCount, pluralRu } from '../../../shared/format';
import type { ArtistPage, ArtistRelease } from '../../../shared/types';
import { Button, IconButton } from '../../components/Button/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { MoreMenuButton } from '../../components/Menu/Menu';
import { Skeleton, SkeletonRows } from '../../components/Skeleton/Skeleton';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { blockArtistEverywhere, restoreArtist, useBlacklist } from '../../stores/blacklistActions';
import { useFeedInit } from '../../stores/useFeed';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useUi } from '../../stores/useUi';
import { artistWaveSeed, useWave } from '../../stores/useWave';
import { ArtistAvatar } from './ArtistAvatar';
import { ArtistCard, ArtistRow } from './ArtistCard';
import { artistQueryOf, isArtistNotFound, pageKey, useArtistPage, useArtistPages, visibleNamesakes } from './artistData';
import { parseArtistParam } from './artistNav';
import styles from './ArtistScreen.module.css';
import { FollowButton } from './FollowButton';
import { Namesakes } from './Namesakes';
import { ReleaseGrid } from './ReleaseGrid';
import { splitReleases } from './releaseFormat';

const TOP_PREVIEW = 5;
const RELEASES_PREVIEW = 12;

function BackButton() {
  const back = useUi((s) => s.back);
  return <IconButton icon={ChevronLeft} label="Назад" className={styles.back} onClick={back} />;
}

/** «Волна по артисту»: его популярный трек, дальше — его треки и похожие исполнители. */
function ArtistWaveButton({ name, topTracks }: { name: string; topTracks: ArtistPage['topTracks'] }) {
  const key = `artist:${name}`;
  const starting = useWave((s) => s.starting === key);
  return (
    <Button
      variant="outline"
      icon={starting ? LoaderCircle : AudioWaveform}
      className={starting ? 'spin-inner' : undefined}
      disabled={starting}
      onClick={() => void useWave.getState().start(artistWaveSeed(name, topTracks), key)}
    >
      Волна по артисту
    </Button>
  );
}

type ArtistInfo = ArtistPage['artist'];

/** «⋯» справа от «Волна по артисту»: добавить в чёрный список (с подтверждением) или убрать из него. */
function ArtistMenu({ artist, blocked }: { artist: ArtistInfo; blocked: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const name = artist.name.trim();
  return (
    <>
      <MoreMenuButton
        label="Ещё"
        size="large"
        className={styles.moreButton}
        items={[
          blocked
            ? { label: 'Убрать из чёрного списка', icon: Undo2, onSelect: () => restoreArtist(artistKey(name)) }
            : { label: 'Добавить в чёрный список', icon: Ban, danger: true, onSelect: () => setConfirming(true) },
        ]}
      />
      {confirming && (
        <ConfirmDialog
          title="Добавить в чёрный список?"
          text={`Больше не будешь слышать ${name} в волнах и подборках`}
          confirmLabel="В чёрный список"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            blockArtistEverywhere({ name, id: artist.id, ...(artist.imageUrl ? { imageUrl: artist.imageUrl } : {}) });
          }}
        />
      )}
    </>
  );
}

/** Плашка под шапкой заблокированного артиста. */
function BlockedBar({ name }: { name: string }) {
  return (
    <div className={styles.blockedBar} role="status">
      <Ban size={17} className={styles.blockedIcon} />
      <span className={styles.blockedText}>В чёрном списке</span>
      <span className={styles.blockedDot} aria-hidden="true">
        ·
      </span>
      <button type="button" className={styles.blockedRestore} onClick={() => restoreArtist(artistKey(name))}>
        Вернуть
      </button>
    </div>
  );
}

function Header({ page, blocked }: { page: ArtistPage; blocked: boolean }) {
  const { artist, topTracks, releases } = page;
  const eyebrow = ['Артист', artist.genre].filter(Boolean).join(' · ');
  const { albums, singles } = splitReleases(releases);
  const stats = [
    albums.length > 0 && `${albums.length} ${pluralRu(albums.length, 'альбом', 'альбома', 'альбомов')}`,
    singles.length > 0 && `${singles.length} ${pluralRu(singles.length, 'сингл', 'сингла', 'синглов')}`,
    topTracks.length > 0 && `популярное — ${formatTrackCount(topTracks.length)}`,
  ].filter(Boolean);

  return (
    <section className={styles.hero} aria-label={artist.name}>
      {artist.imageUrl && <img className={styles.blur} src={artist.imageUrl} alt="" aria-hidden="true" draggable={false} />}
      <div className={styles.shade} aria-hidden="true" />
      <ArtistAvatar name={artist.name} imageUrl={artist.imageUrl} size={184} />
      <div className={styles.heroBody}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h1 className={styles.name} title={artist.name}>
          {artist.name}
        </h1>
        {stats.length > 0 && <div className={styles.stats}>{stats.join(' · ')}</div>}
        <div className={styles.actions}>
          <Button icon={Play} disabled={topTracks.length === 0} onClick={() => usePlayer.getState().playList(topTracks, 0, artist.name)}>
            Слушать
          </Button>
          <FollowButton artist={{ id: artist.id, name: artist.name, ...(artist.imageUrl ? { imageUrl: artist.imageUrl } : {}) }} />
          <ArtistWaveButton name={artist.name} topTracks={topTracks} />
          <ArtistMenu artist={artist} blocked={blocked} />
        </div>
      </div>
    </section>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function MoreToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button type="button" className={styles.more} onClick={onToggle}>
      {open ? 'Свернуть' : 'Показать все'} <ChevronRight size={14} />
    </button>
  );
}

function Loading() {
  return (
    <>
      <section className={[styles.hero, styles.heroLoading].join(' ')} aria-label="Загрузка артиста">
        <Skeleton width={184} height={184} circle />
        <div className={styles.heroBody}>
          <Skeleton width={120} height={12} />
          <Skeleton width="50%" height={44} radius={12} />
          <div className={styles.actions}>
            <Skeleton width={130} height={44} radius={999} />
            <Skeleton width={160} height={44} radius={999} />
          </div>
        </div>
      </section>
      <SkeletonRows count={5} />
    </>
  );
}

/** Раздел релизов одного вида: первые `RELEASES_PREVIEW` и «Показать все»; без релизов — не показывается. */
function ReleaseSection({ title, releases, artist }: { title: string; releases: ArtistRelease[]; artist: ArtistPage['artist'] }) {
  const [all, setAll] = useState(false);
  if (releases.length === 0) return null;
  return (
    <Section title={title} aside={releases.length > RELEASES_PREVIEW && <MoreToggle open={all} onToggle={() => setAll((v) => !v)} />}>
      <ReleaseGrid releases={all ? releases : releases.slice(0, RELEASES_PREVIEW)} currentArtist={artist.name} />
    </Section>
  );
}

function Content({ page }: { page: ArtistPage }) {
  const [allTop, setAllTop] = useState(false);
  const { artist, topTracks, releases, similar } = page;
  const { albums, singles } = useMemo(() => splitReleases(releases), [releases]);
  const top = allTop ? topTracks : topTracks.slice(0, TOP_PREVIEW);
  const bl = useBlacklist();
  const blocked = isArtistBlocked(artist.name, bl);
  const followed = useLibrary((s) => s.lib.followedArtists);
  const namesakes = useMemo(() => visibleNamesakes(page.namesakes, followed), [page.namesakes, followed]);

  return (
    <>
      <Header page={page} blocked={blocked} />
      {blocked && <BlockedBar name={artist.name} />}
      <Namesakes name={artist.name} namesakes={namesakes} />

      <Section title="Популярные треки" aside={topTracks.length > TOP_PREVIEW && <MoreToggle open={allTop} onToggle={() => setAllTop((v) => !v)} />}>
        {topTracks.length === 0 ? (
          <p className={styles.empty}>
            {blocked ? 'Артист в чёрном списке — его треки скрыты.' : 'Популярных треков у артиста пока нет в каталоге.'}
          </p>
        ) : (
          <TrackTable tracks={top} onPlay={(i) => usePlayer.getState().playList(topTracks, i, artist.name)} showSource={false} hideHeader />
        )}
      </Section>

      <ReleaseSection title="Альбомы" releases={albums} artist={artist} />
      <ReleaseSection title="Синглы" releases={singles} artist={artist} />

      {similar.length > 0 && (
        <Section title="Похожие артисты">
          <ArtistRow label="Похожие артисты">
            {similar.map((a) => (
              <ArtistCard key={a.name} artist={a} />
            ))}
          </ArtistRow>
        </Section>
      )}
    </>
  );
}

export function ArtistScreen({ param }: { param?: string }) {
  useFeedInit();
  // Имя подписки — страница по её id: подписанный артист и на своей странице подписанный, а не тёзка по имени.
  // Подписки читаются при открытии, а не по подписке на стор: отписка здесь же не перезагружает страницу.
  const query = useMemo(() => {
    const parsed = parseArtistParam(param);
    return parsed ? artistQueryOf(parsed, useLibrary.getState().lib.followedArtists) : null;
  }, [param]);
  const key = query ? pageKey(query) : '';
  const entry = useArtistPage(key);
  const navigate = useUi((s) => s.navigate);

  useEffect(() => {
    if (query) useArtistPages.getState().ensure(key, query);
  }, [key]);

  let body: ReactNode;
  if (!query) {
    body = <EmptyState icon={Search} title="Артист не найден" action={{ label: 'К поиску', icon: Search, onClick: () => navigate({ name: 'search' }) }} />;
  } else if (!entry || entry.status === 'loading') {
    body = <Loading />;
  } else if ('name' in query && isArtistNotFound(entry)) {
    // Такого имени в каталоге нет (а тёзку с похожим именем не подставляем) — ищем по имени.
    const name = query.name.trim();
    body = (
      <EmptyState
        icon={Search}
        title={`Артиста «${name}» нет в каталоге`}
        text="Его треки могут найтись на YouTube или SoundCloud."
        action={{ label: `Искать «${name}»`, icon: Search, onClick: () => useUi.getState().setQuery(name) }}
      />
    );
  } else if (entry.status === 'error') {
    body = (
      <EmptyState
        icon={entry.offline ? WifiOff : CircleAlert}
        title={entry.offline ? 'Нет соединения' : 'Не удалось открыть артиста'}
        text={entry.offline ? 'Страница артиста появится, когда вернётся интернет.' : entry.message}
        action={{ label: 'Повторить', icon: RotateCw, onClick: () => useArtistPages.getState().retry(key, query) }}
      />
    );
  } else {
    body = <Content key={entry.value.artist.id} page={entry.value} />;
  }

  return (
    <>
      <BackButton />
      {body}
    </>
  );
}
