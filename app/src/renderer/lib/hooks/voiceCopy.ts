/**
 * The words every voice surface uses for each phase, so the island, Leafy's bubble and the
 * palette never disagree. Plain, short, sentence case (DESIGN.md "Voice & copy").
 */
import type { VoiceMode, VoiceSnapshot } from '@shared/types';
import { pasteShortcut, type Platform } from './accelerator';

/** Short status line, e.g. "Listening", "Opening Calendar", "Pasted". Null when idle. */
export function phaseStatus(snapshot: VoiceSnapshot, platform: Platform = 'darwin'): string | null {
  switch (snapshot.phase) {
    case 'idle':
      return null;
    case 'listening':
      return snapshot.locked ? 'Listening · locked on' : 'Listening';
    case 'transcribing':
      return 'Writing it down';
    case 'thinking':
      return snapshot.mode === 'dictate' ? 'Tidying up' : 'Thinking';
    case 'acting':
      return snapshot.detail ?? 'Working on it';
    case 'confirming':
      return 'Waiting for your yes';
    case 'speaking':
      return 'Speaking';
    case 'done':
      return doneStatus(snapshot, platform);
    case 'error':
      return snapshot.error?.code === 'cancelled' ? 'Stopped' : 'That didn’t work';
    default:
      return null;
  }
}

function doneStatus(snapshot: VoiceSnapshot, platform: Platform): string {
  if (snapshot.mode === 'command') return 'Done';
  return snapshot.pasted ? 'Pasted' : `Copied — press ${pasteShortcut(platform)} to paste`;
}

/** The calm, shimmering working label in the island ("Writing…", "Thinking…"). */
export function workingLabel(snapshot: VoiceSnapshot): string {
  if (snapshot.phase === 'transcribing') return 'Writing…';
  return snapshot.mode === 'dictate' ? 'Tidying up…' : 'Thinking…';
}

export const MODE_LABEL: Readonly<Record<VoiceMode, string>> = {
  dictate: 'Dictate',
  ask: 'Ask',
  command: 'Leafy',
};

/** True for phases where something is in flight and Esc / stop should cancel it. */
export function isBusyPhase(phase: VoiceSnapshot['phase']): boolean {
  return phase === 'transcribing' || phase === 'thinking' || phase === 'acting' || phase === 'confirming' || phase === 'speaking';
}
