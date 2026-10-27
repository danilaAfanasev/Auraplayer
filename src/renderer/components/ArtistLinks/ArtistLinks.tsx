// Имена исполнителей ссылками на страницы артистов — одна на всё приложение: строки таблиц, карточки, панели.
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { artistKey } from '../../../shared/artistNames';
import { openArtistByName, type KnownArtist } from '../../screens/artist/artistData';
import { artistLinkParts } from './artistLinkParts';
import styles from './ArtistLinks.module.css';

interface Props {
  /** Строка исполнителей трека или релиза («A & B feat. C»). */
  artist: string;
  /** Название: фиты из него («Song (feat. C)») — тоже ссылки. */
  title?: string;
  className?: string;
  /** Это имя — не ссылка (страница этого артиста уже открыта). */
  except?: string;
  /** Исполнители с известным id (единственный исполнитель релиза): их имя открывает страницу по id. */
  known?: readonly KnownArtist[];
}

/**
 * Каждое имя — ссылка: клик открывает страницу артиста (точное имя в каталоге, иначе — поиск по имени), не включает
 * трек и не доходит до строки или карточки вокруг. Имена — строчные элементы, а не <button>: кнопка в Chromium —
 * неразрывный блок, и длинное имя обрезалось бы без «…». Enter и пробел работают как клик.
 */
export function ArtistLinks({ artist, title, className, except, known }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const skip = except ? artistKey(except) : '';
  const open = (name: string) => {
    if (busy) return;
    setBusy(name);
    void openArtistByName(name, known).finally(() => setBusy(null));
  };
  const stop = (e: MouseEvent) => e.stopPropagation();
  const parts = artistLinkParts(artist, title);
  const full = parts.map((p) => p.text).join('');

  return (
    <span className={[styles.links, className].filter(Boolean).join(' ')} title={full}>
      {parts.map((part, i) =>
        part.name && artistKey(part.name) !== skip ? (
          <span
            key={i}
            role="link"
            tabIndex={0}
            className={[styles.link, busy === part.name ? styles.busy : ''].join(' ')}
            aria-label={`Открыть страницу артиста ${part.name}`}
            aria-busy={busy === part.name}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              open(part.name!);
            }}
            onDoubleClick={stop}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              open(part.name!);
            }}
          >
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
