// Раздел SoundCloud: «Волна SoundCloud», «Популярное на SoundCloud» (чарты по жанрам) и «Свежее на SoundCloud»
// (новые и набирающие популярность). Только полные треки: отрывки и DRM отсеивает main.
import { AudioWaveform, Cloud, Flame, LoaderCircle, Play, RefreshCw, RotateCw, Sparkles, WifiOff, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SC_GENRES, SC_REGIONS, type ScChartKind, type ScGenre, type ScRegion } from '../../../shared/api';
import { timeAgo } from '../../../shared/format';
import type { Track } from '../../../shared/types';
import { IconButton } from '../../components/Button/Button';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { PlayButtons } from '../../components/PlayButtons/PlayButtons';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { TrackTable } from '../../components/TrackTable/TrackTable';
import { useNow } from '../../components/useNow';
import { useLibrary } from '../../stores/useLibrary';
import { usePlayer } from '../../stores/usePlayer';
import { useSettings } from '../../stores/useSettings';
import { SOUNDCLOUD_WAVE_TITLE, soundcloudWaveSeed, useWave } from '../../stores/useWave';
import styles from './SoundcloudScreen.module.css';
import { useScChart } from './useScChart';

const GENRE_LABELS: Record<ScGenre, string> = {
  all: 'Все жанры',
  hiphop: 'Хип-хоп и рэп',
  electronic: 'Электроника',
  pop: 'Поп',
  rnb: 'R&B',
};

const REGION_LABELS: Record<ScRegion, string> = {
  all: 'Все регионы',
  us: 'США',
  uk: 'Великобритания',
  ru: 'Россия',
};

/** Сколько строк списка видно сразу (остальное — «Показать все»). */
const PREVIEW = 15;
const WAVE_KEY = 'soundcloud-wave';
const NO_TRACKS: Track[] = [];
const PREFS_KEY = 'aura.soundcloud.view';

interface ViewPrefs {
  region: ScRegion;
  topGenre: ScGenre;
  freshGenre: ScGenre;
}

const DEFAULT_PREFS: ViewPrefs = { region: 'all', topGenre: 'hiphop', freshGenre: 'all' };

/** Выбранные жанры и регион — удобство одного окна; хранилище может быть недоступно. */
function readPrefs(): ViewPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ViewPrefs> | null;
    return {
      region: SC_REGIONS.includes(raw?.region as ScRegion) ? (raw!.region as ScRegion) : DEFAULT_PREFS.region,
      topGenre: SC_GENRES.includes(raw?.topGenre as ScGenre) ? (raw!.topGenre as ScGenre) : DEFAULT_PREFS.topGenre,
      freshGenre: SC_GENRES.includes(raw?.freshGenre as ScGenre) ? (raw!.freshGenre as ScGenre) : DEFAULT_PREFS.freshGenre,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: ViewPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* без запоминания */
  }
}

function Chips<T extends string>({ values, labels, value, onChange, label }: { values: readonly T[]; labels: Record<T, string>; value: T; onChange(v: T): void; label: string }) {
  return (
    <div className={styles.chips} role="radiogroup" aria-label={label}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={[styles.chip, v === value ? styles.chipOn : ''].join(' ')}
          onClick={() => onChange(v)}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}

function WaveCard({ fallback }: { fallback: readonly Track[] }) {
  const starting = useWave((s) => s.starting === WAVE_KEY);
  const playing = useWave((s) => s.active?.title === SOUNDCLOUD_WAVE_TITLE);
  const lib = useLibrary((s) => s.lib);
  const seed = useMemo(() => soundcloudWaveSeed(lib, fallback), [lib, fallback]);
  const personal = useMemo(() => soundcloudWaveSeed(lib, []) !== null, [lib]);
  return (
    <button
      type="button"
      className={[styles.wave, playing ? styles.wavePlaying : ''].join(' ')}
      disabled={starting || !seed}
      onClick={() => seed && void useWave.getState().start(seed, WAVE_KEY)}
    >
      <span className={styles.waveIcon} aria-hidden="true">
        {starting ? <LoaderCircle size={26} className="spin" /> : playing ? <AudioWaveform size={26} /> : <Play size={24} fill="currentColor" strokeWidth={0} />}
      </span>
      <span className={styles.waveText}>
        <span className={styles.waveTitle}>{SOUNDCLOUD_WAVE_TITLE}</span>
        <span className={styles.waveSub}>
          {starting
            ? 'Подбираю треки…'
            : playing
              ? 'Играет — SoundCloud сам подбирает похожие'
              : !seed
                ? 'Появится, когда загрузится популярное'
                : personal
                  ? 'Бесконечно похожее на то, что ты слушал и лайкал на SoundCloud'
                  : 'Бесконечно похожее на самый популярный трек SoundCloud'}
        </span>
      </span>
    </button>
  );
}

/** «Обновлено N назад» · «Не обновилось» · «Обновить». */
function Status({ updatedAt, error, loading, onRefresh }: { updatedAt: number | null; error: { message: string } | null; loading: boolean; onRefresh(): void }) {
  const now = useNow();
  return (
    <div className={styles.status}>
      {error && !loading && (
        <span className={styles.offline} role="status" title={error.message}>
          <WifiOff size={13} strokeWidth={2.4} /> Не обновилось
        </span>
      )}
      <span className={styles.updated}>
        {loading ? (
          <>
            <LoaderCircle size={13} className="spin" /> Обновляется…
          </>
        ) : updatedAt ? (
          `Обновлено ${timeAgo(updatedAt, Math.max(now, updatedAt))}`
        ) : null}
      </span>
      <IconButton icon={RefreshCw} size="small" label="Обновить" title="Обновить" disabled={loading} onClick={onRefresh} />
    </div>
  );
}

interface ChartSectionProps {
  kind: ScChartKind;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  genre: ScGenre;
  region: ScRegion;
  onGenre(g: ScGenre): void;
  emptyText: string;
}

function ChartSection({ kind, icon: Icon, title, subtitle, genre, region, onGenre, emptyText }: ChartSectionProps) {
  const { result, loading, retry } = useScChart({ kind, genre, region });
  const [expanded, setExpanded] = useState(false);
  const tracks = result?.tracks ?? [];
  const shown = expanded ? tracks : tracks.slice(0, PREVIEW);
  // Заголовок очереди — имя этого списка: «Популярное на SoundCloud · Поп».
  const listTitle = genre === 'all' ? title : `${title} · ${GENRE_LABELS[genre]}`;

  return (
    <section className={styles.block}>
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          <Icon size={22} strokeWidth={2.2} />
        </span>
        <div className={styles.heading}>
          <h2>{title}</h2>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
        <div className={styles.aside}>
          {tracks.length > 0 && <PlayButtons tracks={tracks} title={listTitle} />}
        </div>
      </header>
      <div className={styles.bar}>
        <Chips values={SC_GENRES} labels={GENRE_LABELS} value={genre} onChange={onGenre} label={`${title}: жанр`} />
        <Status updatedAt={result?.updatedAt ?? null} error={result?.error ?? null} loading={loading} onRefresh={retry} />
      </div>

      {loading && tracks.length === 0 ? (
        <SkeletonRows count={8} />
      ) : tracks.length === 0 ? (
        result?.error ? (
          <EmptyState icon={WifiOff} title="SoundCloud не отвечает" text={result.error.message} action={{ label: 'Повторить', icon: RotateCw, onClick: retry }} />
        ) : (
          <EmptyState icon={Cloud} title="Пока пусто" text={emptyText} />
        )
      ) : (
        <>
          <TrackTable tracks={shown} onPlay={(i) => usePlayer.getState().playList(tracks, i, listTitle)} showSource={false} />
          {tracks.length > PREVIEW && (
            <button type="button" className={styles.more} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Свернуть' : `Показать все (${tracks.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Disabled() {
  return (
    <EmptyState
      icon={Cloud}
      title="SoundCloud выключен"
      text="Включи его — здесь появятся популярные и свежие треки SoundCloud и волна по его рекомендациям."
      action={{
        label: 'Включить SoundCloud',
        icon: Cloud,
        onClick: () => useSettings.getState().update({ soundcloudEnabled: true }),
      }}
    />
  );
}

/** Раздел SoundCloud. */
export function SoundcloudScreen() {
  const enabled = useSettings((s) => s.settings.soundcloudEnabled);
  const [prefs, setPrefs] = useState<ViewPrefs>(readPrefs);
  const change = (patch: Partial<ViewPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(next);
  };
  // Волна без истории SoundCloud стартует от первого трека популярного (любого жанра, что уже загружен).
  const popular = useScChart({ kind: 'top', genre: prefs.topGenre, region: prefs.region });

  return (
    <>
      <ScreenHeader
        eyebrow="Андеграунд, ремиксы и новые имена — полными треками"
        title="SoundCloud"
        aside={enabled && <Chips values={SC_REGIONS} labels={REGION_LABELS} value={prefs.region} onChange={(region) => change({ region })} label="Регион чартов" />}
      />
      {!enabled ? (
        <Disabled />
      ) : (
        <>
          <WaveCard fallback={popular.result?.tracks ?? NO_TRACKS} />
          <ChartSection
            kind="top"
            icon={Flame}
            title="Популярное на SoundCloud"
            subtitle={prefs.region === 'ru' ? 'Русскоязычные треки SoundCloud с наибольшим числом прослушиваний' : 'Чарты SoundCloud: что больше всего слушают на этой неделе'}
            genre={prefs.topGenre}
            region={prefs.region}
            onGenre={(topGenre) => change({ topGenre })}
            emptyText="В этом чарте сейчас нет треков, которые SoundCloud отдаёт целиком без входа. Попробуй другой жанр или регион."
          />
          <ChartSection
            kind="fresh"
            icon={Sparkles}
            title="Свежее на SoundCloud"
            subtitle={prefs.region === 'ru' ? 'Русскоязычные треки последних двух месяцев, которые слушают больше всего' : 'Новые треки, которые быстро набирают прослушивания, и новые имена'}
            genre={prefs.freshGenre}
            region={prefs.region}
            onGenre={(freshGenre) => change({ freshGenre })}
            emptyText="Свежих треков этого жанра сейчас нет. Попробуй другой жанр или регион."
          />
        </>
      )}
    </>
  );
}
