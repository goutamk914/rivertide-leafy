/**
 * Pure helpers for what the user sees and hears: snapshots, Leafy cues, friendly error messages,
 * yes/no answers to confirmations, word counts and speech-duration estimates.
 */
import type { LeafyCue, VoiceError, VoiceErrorCode, VoiceSnapshot } from '../../shared/types';

export const IDLE_SNAPSHOT: VoiceSnapshot = {
  sessionId: null, phase: 'idle', mode: null, source: null, locked: false, startedAt: null,
  transcript: '', output: '', detail: null, pending: null, pasted: false, error: null,
};

export const ERROR_MESSAGES: Readonly<Record<VoiceErrorCode, string>> = {
  'no-speech': 'I didn’t catch anything. Try again whenever you’re ready.',
  'mic-denied': 'Rivertide can’t hear you yet — allow the microphone in System Settings.',
  'mic-unavailable': 'Rivertide couldn’t open the microphone. Check that one is connected, then try again.',
  'stt-failed': 'I couldn’t turn that into text. Try again in a moment.',
  'stt-not-configured': 'Add a speech key in Settings → AI to start dictating.',
  'llm-failed': 'The AI couldn’t answer just now. Try again in a moment.',
  'llm-not-configured': 'Add an AI key in Settings → AI to ask questions.',
  'paste-failed': 'I couldn’t paste, so the text is on your clipboard — press ⌘V to paste it.',
  'agent-failed': 'Something went wrong while I was working on that.',
  cancelled: 'Cancelled.',
  timeout: 'That took too long, so I stopped.',
  unknown: 'Something went wrong. Try again in a moment.',
};

export const voiceError = (code: VoiceErrorCode, message?: string): VoiceError => ({ code, message: message ?? ERROR_MESSAGES[code] });

const CUE_HOLD_MS = 1800;
const SAY_MAX_CHARS = 140;

export const cue = (mood: LeafyCue['mood'], say: string | null = null, holdMs: number | null = say ? CUE_HOLD_MS : null): LeafyCue => ({
  mood, say: say && say.length > SAY_MAX_CHARS ? `${say.slice(0, SAY_MAX_CHARS - 1)}…` : say, holdMs,
});

/** Tools that look things up get Leafy's "searching" pose; everything else is "working". */
export const moodForTool = (tool: string): LeafyCue['mood'] =>
  /search|recall|list|weather|status|read/.test(tool) ? 'searching' : 'working';

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|confirm|confirmed|affirmative|of course|absolutely|go for it|yes please|please)$/;
const NO = /^(?:no|nope|nah|cancel|stop|don't|do not|never mind|nevermind|forget it|no thanks|no thank you|don't do it)$/;

/** "yes" / "go ahead" → true, "no" / "cancel" → false, anything else → null. */
export function parseYesNo(text: string): boolean | null {
  const normalized = text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:leafy|um|uh|oh)\s+/, '').replace(/\s+(?:leafy|please|thanks|thank you)$/, '');
  if (YES.test(normalized)) return true;
  if (NO.test(normalized)) return false;
  return null;
}

export const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

const MS_PER_WORD = 420;
const MIN_SPEAK_MS = 1200;
const MAX_SPEAK_MS = 30_000;

/** Rough time the engine's TTS needs to read `text` aloud (there is no "finished" event). */
export function estimateSpeechMs(text: string, rate: number): number {
  const ms = (countWords(text) * MS_PER_WORD) / Math.max(0.5, rate);
  return Math.round(Math.min(MAX_SPEAK_MS, Math.max(MIN_SPEAK_MS, ms)));
}

/** Markdown and URLs read badly aloud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True for microphone failures that mean permission was refused. */
export const isPermissionError = (message: string): boolean => /denied|not ?allowed|permission|notallowederror/i.test(message);
