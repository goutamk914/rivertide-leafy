import { useEffect, useState } from 'react';
import type { LeafyMood } from '@rivertide/leafy/moods';
import type { VoicePhase, VoiceSnapshot } from '@shared/types';
import { invoke } from '../../lib/ipc';
import { useIpcEvent } from './useIpc';

/** Live voice session state: initial `voice:snapshot` fetch, then pushed updates. */
export function useVoiceSnapshot(): VoiceSnapshot | null {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    invoke('voice:snapshot', undefined)
      .then((s) => {
        if (alive) setSnapshot((current) => current ?? s);
      })
      .catch(() => undefined); // The pushed snapshot will fill in; nothing for the user to do here.
    return () => {
      alive = false;
    };
  }, []);
  useIpcEvent('voice:snapshot', setSnapshot);
  return snapshot;
}

const PHASE_MOOD: Readonly<Record<VoicePhase, LeafyMood>> = {
  idle: 'idle',
  listening: 'listening',
  transcribing: 'thinking',
  thinking: 'thinking',
  acting: 'working',
  confirming: 'confirm',
  speaking: 'speaking',
  done: 'success',
  error: 'error',
};

/** Leafy's mood for the current voice activity. */
export function moodForPhase(phase: VoicePhase | undefined): LeafyMood {
  return phase ? PHASE_MOOD[phase] : 'idle';
}

const PHASE_WORDS: Readonly<Record<VoicePhase, string>> = {
  idle: 'Ready',
  listening: 'Listening',
  transcribing: 'Writing down what you said',
  thinking: 'Thinking',
  acting: 'Working on it',
  confirming: 'Waiting for your yes',
  speaking: 'Speaking',
  done: 'Done',
  error: 'Something went wrong',
};

export function phaseLabel(phase: VoicePhase | undefined): string {
  return phase ? PHASE_WORDS[phase] : 'Ready';
}
