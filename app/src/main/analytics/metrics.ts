/**
 * Deterministic speech metrics from the user's own words (`HistoryItem.raw`) and the engine's
 * VAD stats. AI output is only used as the comparison side of `editRatio` for dictation.
 * Not a diagnosis — these are personal, relative signals.
 */
import type { DynamicsSession, HistoryItem, Id, SpeechStats } from '../../shared/types';
import { words } from '../knowledge/text';

export const MIN_SESSION_WORDS = 5;
export const MIN_TIMING_MS = 1000;
export const MAX_PLAUSIBLE_WPM = 400;
export const MATTR_WINDOW = 25;

const FILLER_PATTERNS: readonly RegExp[] = [
  /\b(?:u+m+|u+h+m*|a+h+)\b/giu,
  // Case-sensitive so the acronym "ER" (emergency room) is never counted as a filler.
  /\b[Ee]r+m*\b/gu,
  /(?:,\s*like\b,?|\blike\s*,)/giu,
  /\b(?:you\s+know|i\s+mean|sort\s+of|kind\s+of)\b/giu,
];

const SELF_CORRECTION = /\b(?:no,?\s+wait|i\s+mean|actually|sorry|scratch\s+that|let\s+me\s+rephrase)\b/giu;

const countMatches = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

export function countFillers(text: string): number {
  return FILLER_PATTERNS.reduce((sum, pattern) => sum + countMatches(text, pattern), 0);
}

export function countSelfCorrections(text: string): number {
  return countMatches(text, SELF_CORRECTION);
}

/** Immediate repeats: a repeated word ("I I think") or a repeated pair ("I went I went"). */
export function countRepetitions(tokens: readonly string[]): number {
  let count = 0;
  let i = 1;
  while (i < tokens.length) {
    const pairRepeats = i + 2 < tokens.length && tokens[i - 1] !== tokens[i]
      && tokens[i - 1] === tokens[i + 1] && tokens[i] === tokens[i + 2];
    if (pairRepeats) {
      count += 1;
      i += 3;
    } else {
      if (tokens[i] === tokens[i - 1]) count += 1;
      i += 1;
    }
  }
  return count;
}

/** Moving-average type-token ratio (window 25); plain TTR for shorter texts. */
export function movingTypeTokenRatio(tokens: readonly string[], window: number = MATTR_WINDOW): number {
  if (tokens.length === 0) return 0;
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  const counts = new Map<string, number>();
  for (const token of tokens.slice(0, window)) counts.set(token, (counts.get(token) ?? 0) + 1);
  let total = counts.size / window;
  for (let i = window; i < tokens.length; i += 1) {
    const out = tokens[i - window];
    const remaining = (counts.get(out) ?? 0) - 1;
    if (remaining <= 0) counts.delete(out);
    else counts.set(out, remaining);
    counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
    total += counts.size / window;
  }
  return total / (tokens.length - window + 1);
}

/** Word-level Levenshtein distance (two rows; word level keeps long dictations cheap). */
export function editDistance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}

export function editRatio(raw: string, output: string): number {
  const before = words(raw);
  if (before.length === 0) return 0;
  return Math.min(1, editDistance(before, words(output)) / before.length);
}

export function wordsPerMinute(wordCount: number, stats: SpeechStats): number {
  const timing = stats.speechMs >= MIN_TIMING_MS ? stats.speechMs : stats.durationMs >= MIN_TIMING_MS ? stats.durationMs : 0;
  if (timing === 0) return 0;
  const wpm = wordCount / (timing / 60_000);
  return wpm > MAX_PLAUSIBLE_WPM ? 0 : wpm;
}

const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

/** Metrics for one finished session, or null when it is too short to say anything. */
export function computeSessionMetrics(item: HistoryItem, stats: SpeechStats, id: Id): DynamicsSession | null {
  const tokens = words(item.raw);
  if (tokens.length < MIN_SESSION_WORDS) return null;
  const fillerCount = countFillers(item.raw);
  return {
    id,
    historyId: item.id,
    createdAt: item.createdAt,
    mode: item.mode,
    durationMs: Math.round(stats.durationMs),
    speechMs: Math.round(stats.speechMs),
    words: tokens.length,
    wpm: round(wordsPerMinute(tokens.length, stats), 1),
    pauseCount: stats.pauseCount,
    longPauseCount: stats.longPauseCount,
    meanPauseMs: Math.round(stats.meanPauseMs),
    fillerCount,
    fillerRate: round((100 * fillerCount) / tokens.length, 2),
    repetitionCount: countRepetitions(tokens),
    selfCorrectionCount: countSelfCorrections(item.raw),
    typeTokenRatio: round(movingTypeTokenRatio(tokens), 3),
    editRatio: item.mode === 'dictate' ? round(editRatio(item.raw, item.output), 3) : 0,
    hourOfDay: new Date(item.createdAt).getHours(),
  };
}
