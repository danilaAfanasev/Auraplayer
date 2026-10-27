// «Мои артисты»: подписки (отписка — на карточке), их свежие релизы и свежее от похожих.
import { pluralRu } from '../../../shared/format';
import { ScreenHeader } from '../../components/ScreenHeader/ScreenHeader';
import { useFeedInit } from '../../stores/useFeed';
import { useLibrary } from '../../stores/useLibrary';
import { ArtistCard, ArtistRow } from '../artist/ArtistCard';
import { FollowButton } from '../artist/FollowButton';
import { FollowedFeedBlock, SimilarFeedBlock } from '../home/FeedBlocks';
import { FollowSuggestions } from './FollowSuggestions';
import styles from './FollowingScreen.module.css';

export function FollowingScreen() {
  useFeedInit();
  const artists = useLibrary((s) => s.lib.followedArtists);
  const count = artists.length;

  return (
    <>
      <ScreenHeader
        eyebrow={count > 0 ? `Библиотека · ${count} ${pluralRu(count, 'артист', 'артиста', 'артистов')}` : 'Библиотека'}
        title="Мои артисты"
      />
      {count === 0 ? (
        <FollowSuggestions />
      ) : (
        <>
          <section className={styles.block}>
            <ArtistRow label="Подписки">
              {artists.map((a) => (
                <ArtistCard key={a.id} artist={a} subtitle="Подписка" action={<FollowButton artist={a} small />} />
              ))}
            </ArtistRow>
          </section>
          <FollowedFeedBlock linkTitle={false} />
          <SimilarFeedBlock />
        </>
      )}
    </>
  );
}
