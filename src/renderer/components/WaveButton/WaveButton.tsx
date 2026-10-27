import { AudioWaveform } from 'lucide-react';
import type { Track } from '../../../shared/types';
import { trackWaveSeed, useWave } from '../../stores/useWave';
import { IconButton } from '../Button/Button';

/** «Волна по треку»: этот трек играет сразу, дальше — бесконечно похожие. */
export function WaveButton({ track, size = 'small' }: { track: Track | null; size?: 'small' | 'medium' }) {
  return (
    <IconButton
      icon={AudioWaveform}
      label="Волна по треку — дальше похожие"
      size={size}
      disabled={!track}
      onClick={() => track && void useWave.getState().start(trackWaveSeed(track))}
    />
  );
}
