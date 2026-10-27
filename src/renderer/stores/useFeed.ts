// Лента артистов в рендерере: «Новое от моих артистов» и «Свежее от похожих».
// Main собирает её при запуске и каждые 6 часов (вместе с «Популярным сейчас») и присылает снимки;
// здесь — подписка на снимки, «Обновить» и пересборка после подписки/отписки.
import { useEffect } from 'react';
import { create } from 'zustand';
import type { ArtistFeedSnapshot } from '../../shared/api';
import { errorMessage } from '../app/errors';
import { isFeedOutdated } from '../screens/home/feedView';
import { flushLibrary, useLibrary } from './useLibrary';
import { useUi } from './useUi';

/** Пауза после подписки перед пересборкой ленты: «Подписаться» на нескольких подряд — одна сборка. */
export const FEED_REFRESH_DELAY_MS = 1200;

interface FeedState extends ArtistFeedSnapshot {
  /** Первый снимок из main ещё не пришёл. */
  loading: boolean;
  refresh(): Promise<void>;
}

const EMPTY: ArtistFeedSnapshot = { updatedAt: null, followed: [], similar: [], followedIds: [], refreshing: false, error: null };

export const useFeed = create<FeedState>((set) => ({
  ...EMPTY,
  loading: true,

  async refresh() {
    set({ refreshing: true });
    try {
      // Main берёт подписки из library.json — сначала дописываем отложенное сохранение.
      await flushLibrary();
      set({ ...(await window.aura.artists.refreshFeed()), loading: false });
    } catch (err) {
      set({ refreshing: false, loading: false });
      useUi.getState().toast(errorMessage(err, 'Не удалось обновить ленту'), undefined, 'error');
    }
  },
}));

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const currentFollowIds = () => useLibrary.getState().lib.followedArtists.map((a) => a.id);
const followKey = () => currentFollowIds().sort().join(',');

/** Подписка на снимки main, первый запрос и пересборка ленты при смене подписок; повторные вызовы ничего не делают. */
export function initFeed(): void {
  if (started) return;
  started = true;
  window.aura.artists.onFeed((snap) => useFeed.setState({ ...snap, loading: false }));
  window.aura.artists
    .feed()
    .then((snap) => {
      useFeed.setState({ ...snap, loading: false });
      // Сохранённая лента собрана по другим подпискам (прошлая пересборка сорвалась) — собрать заново сейчас.
      if (!snap.refreshing && isFeedOutdated(snap.followedIds, currentFollowIds())) void useFeed.getState().refresh();
    })
    .catch(() => useFeed.setState({ loading: false }));

  let key = followKey();
  useLibrary.subscribe(() => {
    const next = followKey();
    if (next === key) return;
    key = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void useFeed.getState().refresh();
    }, FEED_REFRESH_DELAY_MS);
  });
}

/** Хук экранов: запускает ленту при первом показе. */
export function useFeedInit(): void {
  useEffect(() => initFeed(), []);
}
