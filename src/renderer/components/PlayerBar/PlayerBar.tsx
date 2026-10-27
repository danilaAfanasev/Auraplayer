import {
  AudioWaveform,
  LoaderCircle,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  ThumbsDown,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { formatDuration } from '../../../shared/format';
import type { RepeatMode } from '../../../shared/types';
import { dislikeTrack } from '../../stores/blacklistActions';
import { initPlayer, useCurrentTrack, usePlayer } from '../../stores/usePlayer';
import { useWave } from '../../stores/useWave';
import { AddToPlaylistButton } from '../AddToPlaylistMenu/AddToPlaylistMenu';
import { ArtistLinks } from '../ArtistLinks/ArtistLinks';
import { IconButton } from '../Button/Button';
import { DownloadButton } from '../DownloadButton/DownloadButton';
import { LikeButton } from '../LikeButton/LikeButton';
import { SourceBadge } from '../SourceBadge/SourceBadge';
import { WaveButton } from '../WaveButton/WaveButton';
import styles from './PlayerBar.module.css';

/** Подсказка говорит состояние кнопки, а не действие. */
const REPEAT_LABELS: Record<RepeatMode, string> = {
  off: 'Повтор выключен',
  all: 'Повтор: все',
  one: 'Повтор: один',
};

/** «Волна: <название>» — играет волна; крестик выключает её (очередь становится обычной). */
function WaveBadge() {
  const wave = useWave((s) => s.active);
  const refilling = useWave((s) => s.refilling);
  if (!wave) return null;
  return (
    <div className={styles.wave}>
      {refilling ? <LoaderCircle size={12} className="spin" aria-label="Подбираю похожие" /> : <AudioWaveform size={12} />}
      <span className={styles.waveTitle} title={`Волна: ${wave.title}`}>
        Волна: {wave.title}
      </span>
      <button type="button" className={styles.waveOff} aria-label="Выключить волну" title="Выключить волну" onClick={() => useWave.getState().stop()}>
        <X size={12} />
      </button>
    </div>
  );
}

function NowPlayingInfo() {
  const track = useCurrentTrack();
  return (
    <div className={styles.track}>
      <div className={styles.cover}>
        {track?.coverUrl ? <img key={track.coverUrl} src={track.coverUrl} alt="" draggable={false} /> : <Music size={18} />}
      </div>
      <div className={styles.meta}>
        <WaveBadge />
        <div className={styles.title} title={track?.title}>
          {track ? track.title : 'Ничего не играет'}
        </div>
        <div className={styles.sub}>
          {track && <SourceBadge source={track.source} />}
          {track ? <ArtistLinks artist={track.artist} title={track.title} className={styles.artist} /> : <span className={styles.artist}>Выбери трек</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * «Не нравится», ♥, «+», «Скачать», «Волна по треку» для играющего трека — одного размера, в один ряд.
 * «Не нравится» — у любого трека: он уходит в чёрный список, плеер переходит к следующему.
 */
function TrackActions() {
  const track = useCurrentTrack();
  return (
    <div className={styles.actions}>
      <IconButton
        icon={ThumbsDown}
        size="medium"
        label="Не нравится — скрыть этот трек и включить следующий"
        disabled={!track}
        onClick={() => track && dislikeTrack(track)}
      />
      <LikeButton track={track} size="medium" />
      <AddToPlaylistButton track={track} icon="list" size="medium" />
      <DownloadButton track={track} size="medium" />
      <WaveButton track={track} size="medium" />
    </div>
  );
}

function Transport() {
  const hasTrack = usePlayer((s) => s.index >= 0 && s.queue.length > 0);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const { toggle, next, prev, cycleRepeat, toggleShuffle } = usePlayer.getState();

  const playLabel = isLoading ? 'Загрузка…' : isPlaying ? 'Пауза' : 'Играть';
  return (
    <div className={styles.transport}>
      <IconButton
        icon={repeat === 'one' ? Repeat1 : Repeat}
        label={REPEAT_LABELS[repeat]}
        active={repeat !== 'off'}
        toggle
        onClick={cycleRepeat}
      />
      <IconButton icon={SkipBack} label="Предыдущий" filled disabled={!hasTrack} onClick={prev} />
      <button
        type="button"
        className={styles.play}
        aria-label={playLabel}
        title={playLabel}
        disabled={!hasTrack}
        onClick={toggle}
      >
        {isLoading ? (
          <LoaderCircle size={22} className="spin" />
        ) : isPlaying ? (
          <Pause size={20} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play size={20} fill="currentColor" strokeWidth={0} className={styles.playIcon} />
        )}
      </button>
      <IconButton icon={SkipForward} label="Следующий" filled disabled={!hasTrack} onClick={next} />
      <IconButton
        icon={Shuffle}
        label={shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'}
        active={shuffle}
        toggle
        onClick={toggleShuffle}
      />
    </div>
  );
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const { setVolume, toggleMute } = usePlayer.getState();
  const shown = muted ? 0 : volume;
  const icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className={styles.volume}>
      <IconButton icon={icon} label={muted ? 'Включить звук' : 'Выключить звук'} size="small" onClick={toggleMute} />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        aria-label="Громкость"
        title={`Громкость ${Math.round(shown * 100)}%`}
        className={styles.volumeSlider}
        style={{ '--fill': `${shown * 100}%` } as CSSProperties}
        onChange={(e) => setVolume(Number(e.target.value))}
      />
    </div>
  );
}

function Progress() {
  const hasTrack = usePlayer((s) => s.index >= 0 && s.queue.length > 0);
  const position = usePlayer((s) => s.positionSec);
  const duration = usePlayer((s) => s.durationSec);
  const seek = usePlayer((s) => s.seek);
  // Пока ползунок тянут мышью — показываем позицию под пальцем, перематываем на отпускании.
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  const max = duration > 0 ? duration : 0;
  const fill = max > 0 ? Math.min(100, (shown / max) * 100) : 0;

  const commit = () => {
    if (drag !== null) seek(drag);
    setDrag(null);
  };

  return (
    <div className={styles.progress}>
      <span className={styles.time}>{formatDuration(hasTrack ? shown : 0)}</span>
      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.1}
        value={max > 0 ? Math.min(shown, max) : 0}
        aria-label="Позиция трека"
        className={styles.progressSlider}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        disabled={!hasTrack || max === 0}
        onPointerDown={() => setDrag(position)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (drag !== null) setDrag(v);
          else seek(v); // клавиатура: стрелки перематывают сразу
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onBlur={commit}
      />
      <span className={styles.time}>{hasTrack && max > 0 ? formatDuration(max) : formatDuration(0)}</span>
    </div>
  );
}

/** Нижняя панель плеера: трек, действия, транспорт, громкость, прогресс. Подключает плеер к окну. */
export function PlayerBar() {
  useEffect(() => {
    initPlayer();
  }, []);

  return (
    <section className={styles.bar} aria-label="Плеер">
      {/* Обёртка — чтобы раскладку можно было менять по ширине панели (container query на .bar). */}
      <div className={styles.layout}>
        <div className={styles.top}>
          <NowPlayingInfo />

          <TrackActions />

          <Transport />
          <VolumeControl />
        </div>

        <Progress />
      </div>
    </section>
  );
}
