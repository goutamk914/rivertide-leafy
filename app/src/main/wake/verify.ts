/**
 * Stage 2 of the "Hey Leafy" detector: the decision rule applied to a local transcription of the
 * last 1.5 s of audio (Moonshine Tiny, see moonshine.ts). Pure; mirrors scripts/wake-word/verifier.py.
 *
 * Small speech models rarely spell "Leafy" right ("Hey, Lacy."), so a candidate is confirmed when
 * either the transcript names Leafy after a greeting, or "Hey, Leafy." scored as a forced
 * continuation of the transcript is nearly as likely as what the model heard on its own.
 */
import type { WakeSensitivity } from './gate';

export const BOS_TOKEN = 1;
export const EOS_TOKEN = 2;
/** Greedy decoding stops here; 1.5 s of speech is at most a handful of words. */
export const MAX_TRANSCRIPT_TOKENS = 10;
/** Longest transcript prefix the wake phrase is scored after (words heard before "Hey"). */
export const MAX_PREFIX_TOKENS = 6;

/** Moonshine token ids for "Hey, Leafy." / "Hey Leafy." / "Hey, leafy." / "Hey leafy." / "Hey, Leafy!" / "Hey Leafy!". */
export const WAKE_CANDIDATES: readonly (readonly number[])[] = [
  [18637, 29892, 951, 2142, 29891, 29889],
  [18637, 951, 2142, 29891, 29889],
  [18637, 29892, 20447, 29891, 29889],
  [18637, 20447, 29891, 29889],
  [18637, 29892, 951, 2142, 29891, 29991],
  [18637, 951, 2142, 29891, 29991],
];

/** How far (in nats) the wake phrase may trail the model's own transcript and still count. */
export const VERIFY_MARGINS: Readonly<Record<WakeSensitivity, number>> = { low: 6, medium: 8, high: 10 };

// Not "a": "a leafy street" must not count. A "Hey" heard as "A" is left to the likelihood check.
const GREETING = /^(hey|hay|hei|heh|hej|eh)$/;
const LEAFY = /^l(e|ee|ea|ie|i)f+(y|ie|ey|i|ee)$/;

export interface Verdict {
  readonly accepted: boolean;
  readonly transcript: string;
  /** Best wake-phrase log-probability minus the transcript's own (≤ 0 means less likely). */
  readonly margin: number;
  /** The transcript itself says "Hey Leafy" (or a close spelling). */
  readonly named: boolean;
}

/** True when the words contain a greeting followed by "Leafy" or a close spelling ("heyleafy" too). */
export function namesLeafy(transcript: string): boolean {
  const words = transcript.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.some((w) => w.startsWith('hey') && LEAFY.test(w.slice(3)))) return true;
  return words.slice(1).some((w, i) => GREETING.test(words[i] ?? '') && LEAFY.test(w));
}

/** Every wake-phrase candidate appended to every transcript prefix (including the empty one). */
export function candidateSequences(transcript: readonly number[]): number[][] {
  const prefixes = Math.min(transcript.length, MAX_PREFIX_TOKENS);
  const out: number[][] = [];
  for (let k = 0; k <= prefixes; k += 1) {
    for (const candidate of WAKE_CANDIDATES) out.push([...transcript.slice(0, k), ...candidate]);
  }
  return out;
}

export function decide(transcript: string, greedyLogProb: number, candidateLogProbs: readonly number[], margin: number): Verdict {
  const best = candidateLogProbs.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
  const gap = Number.isFinite(best) && Number.isFinite(greedyLogProb) ? best - greedyLogProb : Number.NEGATIVE_INFINITY;
  const named = namesLeafy(transcript);
  return { accepted: named || gap >= -margin, transcript, margin: gap, named };
}
