import { useEffect, useRef, type RefObject } from 'react';
import type { AudioLevel } from '@shared/types';
import { safeOn } from './bridge';

export const SILENT_LEVEL: AudioLevel = Object.freeze({ level: 0, bands: Object.freeze([]) as readonly number[] });

/**
 * The latest microphone level, kept in a ref so 60 Hz `audio:level` pushes never re-render React.
 * Read `ref.current` inside a requestAnimationFrame loop (see the island waveform).
 * With `active = false` the subscription is dropped and the ref falls back to silence.
 */
export function useAudioLevel(active = true): RefObject<AudioLevel> {
  const ref = useRef<AudioLevel>(SILENT_LEVEL);

  useEffect(() => {
    if (!active) {
      ref.current = SILENT_LEVEL;
      return undefined;
    }
    const off = safeOn('audio:level', (next) => {
      ref.current = next;
    });
    return () => {
      off();
      ref.current = SILENT_LEVEL;
    };
  }, [active]);

  return ref;
}
