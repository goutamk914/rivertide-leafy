import { useEffect, useState } from 'react';
import type { VoiceSnapshot } from '@shared/types';
import { reportError, safeInvoke, safeOn } from './bridge';

/** What every voice surface shows before main has answered: nothing is happening. */
export const IDLE_SNAPSHOT: VoiceSnapshot = Object.freeze({
  sessionId: null,
  phase: 'idle',
  mode: null,
  source: null,
  locked: false,
  startedAt: null,
  transcript: '',
  output: '',
  detail: null,
  pending: null,
  pasted: false,
  error: null,
});

/**
 * The live voice session snapshot. Fetches the current one on mount, then follows
 * `voice:snapshot` pushes. A push that arrives before the initial fetch resolves wins.
 */
export function useVoiceSnapshot(): VoiceSnapshot {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>(IDLE_SNAPSHOT);

  useEffect(() => {
    let alive = true;
    let pushed = false;
    const off = safeOn('voice:snapshot', (next) => {
      pushed = true;
      setSnapshot(next);
    });
    safeInvoke('voice:snapshot', undefined)
      .then((initial) => {
        if (alive && !pushed) setSnapshot(initial);
      })
      .catch((error: unknown) => reportError('voice:snapshot', error));
    return () => {
      alive = false;
      off();
    };
  }, []);

  return snapshot;
}
