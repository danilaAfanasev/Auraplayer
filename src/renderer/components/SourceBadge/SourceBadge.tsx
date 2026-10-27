import { Archive, Cloud, Disc3, HardDrive, TvMinimalPlay, type LucideIcon } from 'lucide-react';
import { SOURCE_LABELS, SOURCE_NAMES, type CountryCode, type SourceId } from '../../../shared/types';
import { useCharts } from '../../screens/charts/useCharts';
import { countryGenitive } from '../../screens/home/heroRelease';
import styles from './SourceBadge.module.css';

const ICONS: Record<SourceId, LucideIcon> = {
  archive: Archive,
  youtube: TvMinimalPlay,
  soundcloud: Cloud,
  local: HardDrive,
  catalog: Disc3,
};

/** Подсказка при наведении: откуда трек; у каталога — страна выбранного чарта. */
function sourceTitle(source: SourceId, country: CountryCode | undefined): string {
  if (source === 'local') return 'Файл на диске';
  if (source === 'catalog') return `${['Чарт и каталог', countryGenitive(country)].filter(Boolean).join(' ')} — звук с YouTube`;
  return `Источник: ${SOURCE_NAMES[source]}`;
}

/** Маленькая метка источника трека: Archive / YouTube / SoundCloud / Файл / Каталог. */
export function SourceBadge({ source, className }: { source: SourceId; className?: string }) {
  const Icon = ICONS[source];
  const country = useCharts((s) => s.country);
  return (
    <span className={[styles.badge, className].filter(Boolean).join(' ')} title={sourceTitle(source, country)} data-source={source}>
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
      {SOURCE_LABELS[source]}
    </span>
  );
}
