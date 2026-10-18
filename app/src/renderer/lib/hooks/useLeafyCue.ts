import { useEffect, useState } from 'react';
import type { LeafyCue } from '@shared/types';
import { safeOn } from './bridge';

export interface ReceivedCue {
  readonly cue: LeafyCue;
  /** `Date.now()` when the cue arrived. */
  readonly receivedAt: number;
  /** Increments per cue, so two identical cues still count as two events. */
  readonly seq: number;
}

/** The most recent `leafy:cue` from main (notifications, clap, reminders, caring nudges). */
export function useLeafyCue(): ReceivedCue | null {
  const [received, setReceived] = useState<ReceivedCue | null>(null);

  useEffect(
    () =>
      safeOn('leafy:cue', (cue) => {
        setReceived((previous) => ({ cue, receivedAt: Date.now(), seq: (previous?.seq ?? 0) + 1 }));
      }),
    [],
  );

  return received;
}

/** True while the cue's bubble should still be visible (`holdMs: null` = until the next cue). */
export function isCueActive(received: ReceivedCue | null, now: number): boolean {
  if (!received) return false;
  const { holdMs } = received.cue;
  return holdMs === null || now < received.receivedAt + holdMs;
}
