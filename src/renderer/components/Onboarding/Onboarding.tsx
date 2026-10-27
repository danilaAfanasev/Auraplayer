// Первый запуск «Что ты слушаешь?» — слой поверх приложения: жанры чипами, ниже артисты (популярные своей страны
// с учётом выбранных жанров или поиск по имени). «Готово» — стартовый вкус и подписки, «Пропустить» — сразу главная.
import { Check, LoaderCircle, RotateCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { pluralRu } from '../../../shared/format';
import { GENRES } from '../../../shared/genres';
import type { ArtistRef } from '../../../shared/types';
import { usePopularArtists, useArtistSearch } from '../../screens/artist/artistData';
import { ArtistAvatar } from '../../screens/artist/ArtistAvatar';
import { useBlacklist } from '../../stores/blacklistActions';
import { Button } from '../Button/Button';
import { genreIcon } from '../GenreIcon/genreIcon';
import { Skeleton } from '../Skeleton/Skeleton';
import { finishOnboarding, rankPopular, skipOnboarding } from './onboardingFlow';
import styles from './Onboarding.module.css';

const POPULAR_KEY = 'popular';
const SEARCH_DELAY_MS = 400;
const SHOWN = 18;

function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

function ArtistTile({ artist, selected, onToggle }: { artist: ArtistRef; selected: boolean; onToggle(): void }) {
  return (
    <button type="button" className={[styles.tile, selected ? styles.tileOn : ''].join(' ')} aria-pressed={selected} title={artist.name} onClick={onToggle}>
      <span className={styles.tilePhoto}>
        <ArtistAvatar name={artist.name} imageUrl={artist.imageUrl} size={88} />
        {selected && (
          <span className={styles.tileCheck} aria-hidden="true">
            <Check size={16} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className={styles.tileName}>{artist.name}</span>
    </button>
  );
}

function TilePlaceholders() {
  return (
    <div className={styles.tiles} aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={styles.placeholder}>
          <Skeleton width={88} height={88} circle />
          <Skeleton width={70} height={11} />
        </div>
      ))}
    </div>
  );
}

export function Onboarding() {
  const [genres, setGenres] = useState<string[]>([]);
  const [picked, setPicked] = useState<ArtistRef[]>([]);
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), SEARCH_DELAY_MS);
  const popular = usePopularArtists((s) => s.entries[POPULAR_KEY]);
  const found = useArtistSearch((s) => (query ? s.entries[query] : undefined));
  const blacklist = useBlacklist();

  useEffect(() => {
    usePopularArtists.getState().ensure(POPULAR_KEY, undefined);
  }, []);
  useEffect(() => {
    if (query) useArtistSearch.getState().ensure(query, query);
  }, [query]);

  const popularList = useMemo(
    () => (popular?.status === 'done' ? rankPopular(popular.value, genres, blacklist).slice(0, SHOWN) : []),
    [popular, genres, blacklist],
  );

  const pickedIds = new Set(picked.map((a) => a.id));
  const toggleArtist = (a: ArtistRef) =>
    setPicked((list) => (list.some((x) => x.id === a.id) ? list.filter((x) => x.id !== a.id) : [...list, { id: a.id, name: a.name, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) }]));
  const toggleGenre = (tag: string) => setGenres((list) => (list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]));

  const searching = text.trim() !== '';
  const entry = searching ? found : popular;
  const list: readonly ArtistRef[] = searching ? (found?.status === 'done' ? found.value : []) : popularList;
  const waiting = searching ? query !== text.trim() || !found || found.status === 'loading' : !popular || popular.status === 'loading';

  let artists;
  if (waiting) artists = <TilePlaceholders />;
  else if (entry?.status === 'error')
    artists = (
      <div className={styles.status}>
        <span>{searching ? 'Не удалось найти — проверь соединение' : 'Не удалось загрузить — можно пропустить'}</span>
        <Button
          variant="ghost"
          icon={RotateCw}
          onClick={() => (searching ? useArtistSearch.getState().retry(query, query) : usePopularArtists.getState().retry(POPULAR_KEY, undefined))}
        >
          Повторить
        </Button>
      </div>
    );
  else if (list.length === 0) artists = <div className={styles.status}>{searching ? 'Никого не нашлось — попробуй по-другому' : 'Пока некого показать — можно пропустить'}</div>;
  else
    artists = (
      <div className={styles.tiles}>
        {list.map((a) => (
          <ArtistTile key={a.id} artist={a} selected={pickedIds.has(a.id)} onToggle={() => toggleArtist(a)} />
        ))}
      </div>
    );

  const summary = [
    picked.length > 0 ? `${picked.length} ${pluralRu(picked.length, 'артист', 'артиста', 'артистов')}` : '',
    genres.length > 0 ? `${genres.length} ${pluralRu(genres.length, 'жанр', 'жанра', 'жанров')}` : '',
  ].filter(Boolean);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className={styles.scroll}>
        <div className={styles.content}>
          <header className={styles.head}>
            <span className={styles.eyebrow}>Добро пожаловать в Aura</span>
            <h1 id="onboarding-title">Что ты слушаешь?</h1>
            <p>Выбери жанры и артистов — «Моя волна» и подборки подстроятся под тебя. Можно пропустить: Aura научится сама.</p>
          </header>

          <section className={styles.section} aria-label="Жанры">
            <h2>Жанры</h2>
            <div className={styles.genres}>
              {GENRES.map((g) => {
                const Icon = genreIcon(g.tag);
                const on = genres.includes(g.tag);
                return (
                  <button key={g.tag} type="button" className={[styles.genre, on ? styles.genreOn : ''].join(' ')} aria-pressed={on} onClick={() => toggleGenre(g.tag)}>
                    {on ? <Check size={14} strokeWidth={3} /> : <Icon size={14} />}
                    {g.name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.section} aria-label="Артисты">
            <div className={styles.sectionHead}>
              <h2>{searching ? 'Найденные артисты' : genres.length > 0 ? 'Популярные — сначала твои жанры' : 'Популярные сейчас'}</h2>
              <label className={styles.search}>
                {searching && waiting ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
                <input value={text} maxLength={100} placeholder="Найти артиста по имени" aria-label="Найти артиста по имени" onChange={(e) => setText(e.target.value)} />
                {searching && (
                  <button type="button" className={styles.clear} aria-label="Очистить поиск" onClick={() => setText('')}>
                    <X size={14} />
                  </button>
                )}
              </label>
            </div>
            {picked.length > 0 && (
              <div className={styles.picked} aria-label="Выбранные артисты">
                {picked.map((a) => (
                  <button key={a.id} type="button" className={styles.pickedChip} title="Убрать" onClick={() => toggleArtist(a)}>
                    {a.name}
                    <X size={13} />
                  </button>
                ))}
              </div>
            )}
            {artists}
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.summary}>{summary.length > 0 ? `Выбрано: ${summary.join(' и ')}` : 'Ничего не выбрано'}</span>
        <Button variant="ghost" onClick={skipOnboarding}>
          Пропустить
        </Button>
        <Button icon={Check} onClick={() => finishOnboarding({ artists: picked, genres })}>
          Готово
        </Button>
      </footer>
    </div>
  );
}
