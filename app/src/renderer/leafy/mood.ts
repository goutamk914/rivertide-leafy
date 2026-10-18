/**
 * Pure mood selection for Leafy the desktop pet. Every candidate mood carries a `key` naming one
 * occurrence (this session's success, cue #4, the third yawn...). One-shot moods report back via
 * `LeafySprite.onSettle`; once a key has settled it falls through to the next candidate, so a
 * finished "success" never replays and a later cue still plays.
 */
import { settledMood, type LeafyMood } from '@rivertide/leafy/moods';
import type { Id, VoiceErrorCode, VoiceMode, VoicePhase } from '@shared/types';

export const YAWN_AFTER_MS = 3 * 60_000;
export const YAWN_EVERY_MS = 5 * 60_000;
export const SLEEP_AFTER_MS = 10 * 60_000;
export const NIGHT_STARTS_HOUR = 22;
export const NIGHT_ENDS_HOUR = 7;

export interface MoodInput {
  readonly phase: VoicePhase;
  readonly mode: VoiceMode | null;
  readonly sessionId: Id | null;
  readonly pasted: boolean;
  readonly errorCode: VoiceErrorCode | null;
  /** What the running tool is doing, from `agent:event`. */
  readonly toolActivity: 'working' | 'searching' | null;
  readonly drag: 'dragging' | 'dropped' | null;
  /** Increments per drop so each landing plays once. */
  readonly dropSeq: number;
  /** An active `leafy:cue`, if any. */
  readonly cue: { readonly mood: LeafyMood; readonly seq: number } | null;
  readonly greeting: boolean;
  readonly idleMs: number;
  /** Local hour, 0–23. */
  readonly hour: number;
  readonly sleepAtNight: boolean;
}

export interface MoodChoice {
  readonly mood: LeafyMood;
  /** Identifies this occurrence; used for settling and to restart the animation. */
  readonly key: string;
}

export function isNight(hour: number): boolean {
  return hour >= NIGHT_STARTS_HOUR || hour < NIGHT_ENDS_HOUR;
}

/** Which yawn period we are in (null before the first yawn is due). */
export function yawnPeriod(idleMs: number): number | null {
  if (idleMs < YAWN_AFTER_MS) return null;
  return Math.floor((idleMs - YAWN_AFTER_MS) / YAWN_EVERY_MS);
}

/** The mood a voice phase asks for, or null when the phase has nothing to say. */
export function phaseMood(input: Pick<MoodInput, 'phase' | 'mode' | 'pasted' | 'errorCode' | 'toolActivity'>): LeafyMood | null {
  switch (input.phase) {
    case 'listening':
      return 'listening';
    case 'transcribing':
    case 'thinking':
      return 'thinking';
    case 'acting':
      return input.toolActivity ?? 'working';
    case 'confirming':
      return 'confirm';
    case 'speaking':
      return 'speaking';
    case 'done':
      return input.mode !== 'command' && input.pasted ? 'writing' : 'success';
    case 'error':
      if (input.errorCode === 'cancelled') return null;
      return input.errorCode === 'no-speech' ? 'caring' : 'error';
    default:
      return null;
  }
}

/** All candidates, highest priority first. The caller picks the first one that has not settled. */
export function moodCandidates(input: MoodInput): readonly MoodChoice[] {
  const candidates: MoodChoice[] = [];
  if (input.drag === 'dragging') candidates.push({ mood: 'dragging', key: 'drag' });
  if (input.drag === 'dropped') candidates.push({ mood: 'dropped', key: `drop:${input.dropSeq}` });
  const fromPhase = phaseMood(input);
  if (fromPhase) {
    const activityKey = input.phase === 'acting' ? `:${fromPhase}` : '';
    candidates.push({ mood: fromPhase, key: `${input.sessionId ?? 'session'}:${input.phase}${activityKey}` });
  }
  if (input.cue) candidates.push({ mood: input.cue.mood, key: `cue:${input.cue.seq}` });
  if (input.greeting) candidates.push({ mood: 'greeting', key: 'greeting' });
  if (input.phase === 'idle') {
    if (input.sleepAtNight && isNight(input.hour) && input.idleMs >= SLEEP_AFTER_MS) {
      candidates.push({ mood: 'sleeping', key: 'sleep' });
    }
    const period = yawnPeriod(input.idleMs);
    if (period !== null) candidates.push({ mood: 'yawning', key: `yawn:${period}` });
  }
  candidates.push({ mood: 'idle', key: 'idle' });
  return candidates;
}

/**
 * The mood to show now. A candidate whose key already settled is skipped — unless it loops,
 * in which case `settledMood` is itself and it keeps playing.
 */
export function chooseMood(input: MoodInput, settled: ReadonlySet<string>): MoodChoice {
  const candidates = moodCandidates(input);
  const live = candidates.find((c) => !settled.has(c.key) || settledMood(c.mood) === c.mood);
  return live ?? { mood: 'idle', key: 'idle' };
}

/** Remembers a settled key, keeping the set small. */
export function rememberSettled(settled: ReadonlySet<string>, key: string, limit = 24): ReadonlySet<string> {
  if (settled.has(key)) return settled;
  return new Set([...settled, key].slice(-limit));
}
