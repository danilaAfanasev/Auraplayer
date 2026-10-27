// Главная: «Моя волна» первым действием, живые чипы из вкуса (артисты с высоким рейтингом и жанры пользователя)
// и «Своя волна» — любой артист или жанр. Зашитых артистов нет: без вкуса — популярное и нейтральные жанры.
import { AudioWaveform, LoaderCircle, Play } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useBlacklist } from '../../stores/blacklistActions';
import { hasTaste, MY_WAVE_TITLE, myWaveSeed, tasteChips, type WaveChip } from '../../stores/tasteWave';
import { useLibrary } from '../../stores/useLibrary';
import { useSettings } from '../../stores/useSettings';
import { textWaveSeed, useWave } from '../../stores/useWave';
import { useCharts } from '../charts/useCharts';
import styles from './WaveBlock.module.css';

const MY_WAVE_KEY = 'my-wave';
const CUSTOM_KEY = 'custom';

function MyWaveCard() {
  const starting = useWave((s) => s.starting === MY_WAVE_KEY);
  const playing = useWave((s) => s.active?.title === MY_WAVE_TITLE);
  const lib = useLibrary((s) => s.lib);
  const personal = useMemo(() => hasTaste(lib, Date.now()), [lib]);
  return (
    <button
      type="button"
      className={[styles.myWave, playing ? styles.myWavePlaying : ''].join(' ')}
      disabled={starting}
      onClick={() => void useWave.getState().start(myWaveSeed(useLibrary.getState().lib, Date.now(), useCharts.getState().chart), MY_WAVE_KEY)}
    >
      <span className={styles.myWaveIcon} aria-hidden="true">
        {starting ? <LoaderCircle size={26} className="spin" /> : playing ? <AudioWaveform size={26} /> : <Play size={24} fill="currentColor" strokeWidth={0} />}
      </span>
      <span className={styles.myWaveText}>
        <span className={styles.myWaveTitle}>Моя волна</span>
        <span className={styles.myWaveSub}>
          {starting
            ? 'Подбираю треки…'
            : playing
              ? 'Играет — похожие подбираются сами'
              : personal
                ? 'Бесконечно похожее на то, что ты слушаешь'
                : 'Популярное сейчас и похожее — подстроится под тебя'}
        </span>
      </span>
    </button>
  );
}

/** Включить чип: жанровый — жанр поднимается во вкусе. */
function startChip(chip: WaveChip): void {
  if (chip.genre) useLibrary.getState().recordGenre(chip.genre);
  void useWave.getState().start(chip.seed, chip.id);
}

function WaveChips() {
  const starting = useWave((s) => s.starting);
  const activeTitle = useWave((s) => s.active?.title ?? null);
  const blacklist = useBlacklist();
  const onboarded = useSettings((s) => s.settings.onboarded);
  // Чипы пересчитываются при открытии главной (и после первого запуска, чёрного списка), а не на каждое событие вкуса:
  // включённый чип не уезжает из-под курсора.
  const chips = useMemo(() => tasteChips(useLibrary.getState().lib, Date.now()), [blacklist, onboarded]);
  return (
    <div className={styles.chips} role="group" aria-label="Волны по вкусу">
      {chips.map((chip) => {
        const loading = starting === chip.id;
        // «Играет» — по заголовку волны (имя артиста, название жанра): он не меняется, пока волна идёт.
        const on = activeTitle === chip.seed.title;
        return (
          <button
            key={chip.id}
            type="button"
            className={[styles.chip, on ? styles.chipOn : ''].join(' ')}
            aria-pressed={on}
            disabled={loading}
            onClick={() => startChip(chip)}
          >
            {loading ? <LoaderCircle size={14} className="spin" /> : <AudioWaveform size={14} />}
            {chip.title}
          </button>
        );
      })}
    </div>
  );
}

function CustomWave() {
  const [text, setText] = useState('');
  const starting = useWave((s) => s.starting === CUSTOM_KEY);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || starting) return;
    void useWave.getState().start(textWaveSeed(text), CUSTOM_KEY);
  };
  return (
    <form className={styles.custom} onSubmit={submit}>
      <input
        className={styles.input}
        value={text}
        maxLength={100}
        placeholder="Своя волна — артист или жанр"
        aria-label="Своя волна: артист или жанр"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className={styles.go} disabled={!text.trim() || starting} aria-label="Включить свою волну" title="Включить">
        {starting ? <LoaderCircle size={16} className="spin" /> : <AudioWaveform size={16} />}
      </button>
    </form>
  );
}

export function WaveBlock() {
  return (
    <section className={styles.block} aria-label="Волна">
      <MyWaveCard />
      <div className={styles.side}>
        <WaveChips />
        <CustomWave />
      </div>
    </section>
  );
}
