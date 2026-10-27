import { Ban, Music } from 'lucide-react';
import type { BlockedArtist, BlockedTrack } from '../../../shared/blacklist';
import { restoreArtist, restoreTrack, useBlacklist } from '../../stores/blacklistActions';
import { ArtistAvatar } from '../artist/ArtistAvatar';
import styles from './BlacklistSection.module.css';
import form from './settingsForm.module.css';
import { SettingsSection } from './SettingsSection';

/** «27 октября 2026»; дата неизвестна (старые записи) — пусто. */
function blockedDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function RestoreButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className={styles.restore} title={label} aria-label={label} onClick={onClick}>
      Вернуть
    </button>
  );
}

function ArtistRowItem({ artist }: { artist: BlockedArtist }) {
  return (
    <li className={styles.row}>
      <ArtistAvatar name={artist.name} imageUrl={artist.imageUrl} size={40} />
      <span className={styles.meta}>
        <span className={styles.title}>{artist.name}</span>
      </span>
      <span className={styles.date}>{blockedDate(artist.blockedAt)}</span>
      <RestoreButton label={`Вернуть ${artist.name}`} onClick={() => restoreArtist(artist.key)} />
    </li>
  );
}

function TrackRowItem({ entry }: { entry: BlockedTrack }) {
  const { track } = entry;
  return (
    <li className={styles.row}>
      <span className={styles.cover}>
        {track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy" draggable={false} /> : <Music size={16} />}
      </span>
      <span className={styles.meta}>
        <span className={styles.title} title={track.title}>
          {track.title}
        </span>
        <span className={styles.sub} title={track.artist}>
          {track.artist}
        </span>
      </span>
      <span className={styles.date}>{blockedDate(entry.blockedAt)}</span>
      <RestoreButton label={`Вернуть «${track.title}»`} onClick={() => restoreTrack(track.id)} />
    </li>
  );
}

/**
 * Секция «Чёрный список»: исполнители (с «⋯» на их странице) и треки («Не нравится»), которых больше нигде нет.
 * «Вернуть» возвращает сразу везде: в подборках, волнах и своих списках.
 */
export function BlacklistSection() {
  const { artists, tracks } = useBlacklist();
  return (
    <SettingsSection
      id="blacklist"
      icon={Ban}
      title="Чёрный список"
      description="Этих исполнителей и треков нет в волнах, подборках и рекомендациях. В своих списках и поиске они приглушены."
    >
      <div className={form.field}>
        <h3 className={styles.heading}>
          Исполнители {artists.length > 0 && <span className={styles.count}>{artists.length}</span>}
        </h3>
        {artists.length > 0 ? (
          <ul className={styles.list}>
            {artists.map((a) => (
              <ArtistRowItem key={a.key} artist={a} />
            ))}
          </ul>
        ) : (
          <p className={form.hint}>Здесь пока пусто — на странице артиста: ⋯ → Добавить в чёрный список</p>
        )}
      </div>
      <div className={form.field}>
        <h3 className={styles.heading}>
          Треки {tracks.length > 0 && <span className={styles.count}>{tracks.length}</span>}
        </h3>
        {tracks.length > 0 ? (
          <ul className={styles.list}>
            {tracks.map((b) => (
              <TrackRowItem key={b.track.id} entry={b} />
            ))}
          </ul>
        ) : (
          <p className={form.hint}>Здесь пока пусто — нажми «Не нравится» на треке</p>
        )}
      </div>
    </SettingsSection>
  );
}
