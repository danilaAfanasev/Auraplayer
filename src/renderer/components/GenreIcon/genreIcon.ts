import {
  AudioWaveform,
  Cloud,
  Coffee,
  Disc3,
  Drum,
  Film,
  Flame,
  Guitar,
  Headphones,
  Leaf,
  Mic,
  Moon,
  Music,
  Piano,
  Sparkles,
  Waves,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  electronic: AudioWaveform,
  rock: Guitar,
  pop: Sparkles,
  jazz: Piano,
  classical: Music,
  hiphop: Mic,
  ambient: Cloud,
  lounge: Coffee,
  acoustic: Leaf,
  indie: Headphones,
  metal: Flame,
  folk: Leaf,
  soundtrack: Film,
  blues: Moon,
  reggae: Waves,
  chillout: Waves,
  drums: Drum,
};

/** Иконка жанра для чипов и карточек «Обзора». */
export function genreIcon(tag: string): LucideIcon {
  return ICONS[tag] ?? Disc3;
}
