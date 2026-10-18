import { useState } from 'react';
import { LeafySprite, type LeafyMood } from '@rivertide/leafy';
import { usePresentation } from '../../app-context';

export interface StepLeafyProps {
  /** Plays once (for one-shot moods) and then rests in the mood Leafy settles into. */
  readonly mood: LeafyMood;
  readonly label: string;
  readonly scale?: number;
}

/** Leafy for a step: follows the window's reduced-motion choice and settles after one-shot moods. */
export function StepLeafy({ mood, label, scale = 4 }: StepLeafyProps) {
  const { reduceMotion } = usePresentation();
  const [settled, setSettled] = useState<LeafyMood | null>(null);
  const [playing, setPlaying] = useState(mood);
  if (playing !== mood) {
    // A new mood replays from the start (adjusting state during render, as React recommends).
    setPlaying(mood);
    setSettled(null);
  }
  return (
    <LeafySprite
      mood={settled ?? mood}
      scale={scale}
      label={label}
      reducedMotion={reduceMotion}
      onSettle={(next) => setSettled(next)}
    />
  );
}
