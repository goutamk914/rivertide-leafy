/**
 * Pure speech-bubble selection for Leafy. A live voice session always wins; otherwise the most
 * recent of (the session that just ended, a cue, the greeting) shows until it expires.
 */
import type { LeafyCue, VoiceSnapshot } from '@shared/types';
import type { Platform } from '../lib/hooks/accelerator';
import { headText, tailText } from '../lib/hooks/text';
import { phaseStatus } from '../lib/hooks/voiceCopy';

export const BUBBLE_LINGER_MS = 4500;
export const GREETING_MS = 6000;
const TITLE_CHARS = 72;

export type BubbleTone = 'live' | 'busy' | 'done' | 'error' | 'quiet';

export interface BubbleContent {
  /** Changes whenever the bubble should re-announce itself. */
  readonly key: string;
  readonly title: string;
  readonly status: string | null;
  readonly tone: BubbleTone;
}

export interface BubbleSelection {
  readonly content: BubbleContent | null;
  /** When the current content stops showing (null = while the session runs / until replaced). */
  readonly expiresAt: number | null;
}

export interface EndedSession {
  readonly snapshot: VoiceSnapshot;
  readonly endedAt: number;
}

export interface BubbleInput {
  readonly snapshot: VoiceSnapshot;
  readonly ended: EndedSession | null;
  readonly cue: { readonly cue: LeafyCue; readonly receivedAt: number; readonly seq: number } | null;
  readonly greeting: { readonly title: string; readonly status: string | null; readonly shownAt: number } | null;
  readonly now: number;
  readonly platform?: Platform;
}

function toneFor(snapshot: VoiceSnapshot): BubbleTone {
  switch (snapshot.phase) {
    case 'listening':
      return 'live';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    default:
      return 'busy';
  }
}

function titleFor(snapshot: VoiceSnapshot): string {
  switch (snapshot.phase) {
    case 'listening':
      return snapshot.transcript ? tailText(snapshot.transcript, TITLE_CHARS) : 'I’m listening';
    case 'confirming':
      return snapshot.pending?.title ?? 'Shall I go ahead?';
    case 'speaking':
    case 'done':
      return headText(snapshot.output || snapshot.transcript, TITLE_CHARS) || 'All done';
    case 'error':
      return snapshot.error?.message ?? 'Something went wrong.';
    default:
      return snapshot.transcript ? headText(snapshot.transcript, TITLE_CHARS) : 'One moment';
  }
}

/** Bubble content for a voice snapshot, or null when there is nothing worth saying. */
export function sessionBubble(snapshot: VoiceSnapshot, platform: Platform = 'darwin'): BubbleContent | null {
  if (snapshot.phase === 'idle') return null;
  if (snapshot.phase === 'error' && snapshot.error?.code === 'cancelled') return null;
  return {
    key: `${snapshot.sessionId ?? 'session'}:${snapshot.phase}`,
    title: titleFor(snapshot),
    status: phaseStatus(snapshot, platform),
    tone: toneFor(snapshot),
  };
}

export function isResultPhase(phase: VoiceSnapshot['phase']): boolean {
  return phase === 'done' || phase === 'error';
}

interface Candidate {
  readonly content: BubbleContent;
  readonly since: number;
  readonly expiresAt: number | null;
}

/** Only results linger; a session that was cancelled mid-way just goes quiet. */
function endedCandidate(input: BubbleInput): Candidate | null {
  if (!input.ended || !isResultPhase(input.ended.snapshot.phase)) return null;
  const content = sessionBubble(input.ended.snapshot, input.platform);
  const expiresAt = input.ended.endedAt + BUBBLE_LINGER_MS;
  return content && input.now < expiresAt ? { content, since: input.ended.endedAt, expiresAt } : null;
}

function cueCandidate(input: BubbleInput): Candidate | null {
  const received = input.cue;
  if (!received?.cue.say) return null;
  const expiresAt = received.cue.holdMs === null ? null : received.receivedAt + received.cue.holdMs;
  if (expiresAt !== null && input.now >= expiresAt) return null;
  const content: BubbleContent = { key: `cue:${received.seq}`, title: received.cue.say, status: null, tone: 'quiet' };
  return { content, since: received.receivedAt, expiresAt };
}

function greetingCandidate(input: BubbleInput): Candidate | null {
  const greeting = input.greeting;
  if (!greeting) return null;
  const expiresAt = greeting.shownAt + GREETING_MS;
  if (input.now >= expiresAt) return null;
  const content: BubbleContent = { key: 'greeting', title: greeting.title, status: greeting.status, tone: 'quiet' };
  return { content, since: greeting.shownAt, expiresAt };
}

export function selectBubble(input: BubbleInput): BubbleSelection {
  const live = sessionBubble(input.snapshot, input.platform);
  if (live) return { content: live, expiresAt: null };
  const candidates = [endedCandidate(input), cueCandidate(input), greetingCandidate(input)].filter(
    (c): c is Candidate => c !== null,
  );
  if (candidates.length === 0) return { content: null, expiresAt: null };
  const newest = candidates.reduce((best, c) => (c.since > best.since ? c : best));
  return { content: newest.content, expiresAt: newest.expiresAt };
}

/** "Hi Sam" (or "Hi there"), with a tip line when tips are on. */
export function greetingFor(name: string, tipShortcut: string | null): { title: string; status: string | null } {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return {
    title: first ? `Hi ${first}` : 'Hi there',
    status: tipShortcut ? `Press ${tipShortcut} and tell me what you need` : 'Here when you need me',
  };
}
