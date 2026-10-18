/**
 * Browser-only fixtures (`npm run dev:web`, island.html?scene=…) so every island state can be
 * screenshotted without the main process. Never used inside Electron.
 */
import type { VoiceSnapshot } from '@shared/types';
import { IDLE_SNAPSHOT } from '../lib/hooks/useVoiceSnapshot';

export const DEV_SCENES = [
  'listening',
  'listening-ask',
  'listening-command',
  'transcribing',
  'thinking',
  'acting',
  'confirming',
  'speaking',
  'done',
  'done-short',
  'done-copied',
  'done-reply',
  'error',
  'error-settings',
  'idle',
] as const;

export type DevSceneName = (typeof DEV_SCENES)[number];

/** Reads `?scene=<name>`; unknown names are ignored. */
export function parseDevScene(search: string): DevSceneName | null {
  const value = new URLSearchParams(search).get('scene');
  if (!value) return null;
  return (DEV_SCENES as readonly string[]).includes(value) ? (value as DevSceneName) : null;
}

const base = (patch: Partial<VoiceSnapshot>): VoiceSnapshot => ({
  ...IDLE_SNAPSHOT,
  sessionId: 'dev-session',
  startedAt: '2026-10-15T09:00:00.000Z',
  source: 'fn',
  ...patch,
});

const TRANSCRIPT = 'remind me to call doctor Patel about the scan results tomorrow at ten';
const POLISHED = 'Remind me to call Dr. Patel about the scan results tomorrow at 10 a.m. Ask whether the new dose changes anything.';

export const DEV_SNAPSHOTS: Readonly<Record<DevSceneName, VoiceSnapshot>> = {
  listening: base({ phase: 'listening', mode: 'dictate' }),
  'listening-ask': base({ phase: 'listening', mode: 'ask', source: 'fn' }),
  'listening-command': base({ phase: 'listening', mode: 'command', locked: true, source: 'clap' }),
  transcribing: base({ phase: 'transcribing', mode: 'dictate', transcript: TRANSCRIPT }),
  thinking: base({ phase: 'thinking', mode: 'command', transcript: 'what’s on my calendar tomorrow' }),
  acting: base({ phase: 'acting', mode: 'command', transcript: 'open my calendar', detail: 'Opening Calendar' }),
  confirming: base({
    phase: 'confirming',
    mode: 'command',
    transcript: 'quit spotify',
    pending: { runId: 'dev-run', callId: 'dev-call', tool: 'quit_app', title: 'Quit Spotify', summary: 'Spotify will close. Anything playing will stop.' },
  }),
  speaking: base({ phase: 'speaking', mode: 'command', transcript: 'what time is my appointment', output: 'Your appointment with Dr. Patel is tomorrow at 10 a.m. at the Riverside clinic. I set a reminder for 9.' }),
  done: base({ phase: 'done', mode: 'dictate', transcript: TRANSCRIPT, output: POLISHED, pasted: true }),
  'done-short': base({ phase: 'done', mode: 'dictate', transcript: 'see you soon', output: 'See you soon.', pasted: true }),
  'done-copied': base({ phase: 'done', mode: 'dictate', transcript: TRANSCRIPT, output: POLISHED, pasted: false }),
  'done-reply': base({ phase: 'done', mode: 'command', transcript: 'set a timer for ten minutes', output: 'Timer set for 10 minutes. I’ll let you know when it’s done.' }),
  error: base({ phase: 'error', mode: 'command', error: { code: 'no-speech', message: 'I didn’t catch that. Try again.' } }),
  'error-settings': base({
    phase: 'error',
    mode: 'dictate',
    error: { code: 'stt-not-configured', message: 'Speech-to-text isn’t set up yet. Add a Groq key in Settings, then try again.' },
  }),
  idle: IDLE_SNAPSHOT,
};

/** Speech-like synthetic level for the listening fixtures: syllables with pauses. */
export function syntheticLevel(ms: number): number {
  const phrase = (Math.sin(ms / 1400) + 1) / 2;
  const syllable = Math.max(0, Math.sin(ms / 110)) * (0.6 + 0.4 * Math.sin(ms / 370));
  return Math.min(1, phrase > 0.25 ? 0.15 + 0.6 * syllable * phrase : 0.02);
}
