/**
 * Palette ranking: score = provider weight × match quality (+ usage/recency boosts).
 * Match quality: exact > prefix > word-start > all words > initials > substring > fuzzy.
 */
import type { SearchKind } from '../../shared/types';

export const PROVIDER_WEIGHT: Readonly<Record<SearchKind, number>> = {
  command: 1, app: 1, setting: 0.9, note: 0.8, fact: 0.75, document: 0.75, reminder: 0.7, file: 0.65, history: 0.6, ask: 0.5, web: 0.25,
};

/** Above any weight × quality, so "Ask Leafy" leads when the query reads like a request. */
export const ASK_FIRST_SCORE = 10;
export const ASK_DEFAULT_QUALITY = 0.6;
export const WEB_QUALITY = 0.4;

const MAX_USAGE_BOOST = 0.3;
const USAGE_STEP = 0.06;
const RECENCY_BOOST = 0.15;
const RECENCY_DECAY_MS = 72 * 60 * 60 * 1000;

const QUESTION_WORDS = new Set([
  'what', 'when', 'where', 'who', 'whom', 'whose', 'why', 'how', 'which', 'is', 'are', 'am', 'was', 'were', 'can', 'could',
  'should', 'would', 'will', 'do', 'does', 'did', 'have', 'has', 'may', 'might', 'shall',
]);

const COMMAND_VERBS = new Set([
  'open', 'launch', 'start', 'stop', 'quit', 'close', 'set', 'remind', 'turn', 'play', 'pause', 'resume', 'skip', 'mute',
  'unmute', 'search', 'find', 'look', 'show', 'tell', 'write', 'draft', 'make', 'create', 'add', 'remove', 'delete',
  'cancel', 'call', 'email', 'send', 'help', 'explain', 'summarize', 'summarise', 'read', 'schedule', 'take', 'note',
  'remember', 'list', 'check', 'put', 'give', 'translate', 'define', 'lock', 'raise', 'lower',
]);

export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

const wordsOf = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Characters of `query` appear in order in `text`; tighter spans score higher (0.15–0.4). */
export function fuzzyQuality(query: string, text: string): number {
  if (query.length < 2) return 0;
  let first = -1;
  let position = -1;
  for (const char of query.replace(/ /g, '')) {
    position = text.indexOf(char, position + 1);
    if (position < 0) return 0;
    if (first < 0) first = position;
  }
  const compactness = query.replace(/ /g, '').length / (position - first + 1);
  return 0.15 + 0.25 * compactness;
}

export function matchQuality(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.9;
  const words = wordsOf(t);
  if (words.some((word) => word.startsWith(q))) return 0.75;
  const queryWords = wordsOf(q);
  if (queryWords.length > 1 && queryWords.every((qw) => words.some((word) => word.startsWith(qw)))) return 0.7;
  if (q.length >= 2 && !q.includes(' ') && words.map((word) => word[0]).join('').startsWith(q)) return 0.65;
  if (t.includes(q)) return 0.55;
  return fuzzyQuality(q, t);
}

/** Starts with a question word or a command verb (2+ words), or ends with "?". */
export function looksLikeRequest(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.endsWith('?')) return true;
  const words = wordsOf(normalize(trimmed));
  if (words.length < 2) return false;
  return QUESTION_WORDS.has(words[0]) || COMMAND_VERBS.has(words[0]);
}

export interface UsageEntry { readonly count: number; readonly lastAt: string }

export function usageBoost(entry: UsageEntry | undefined, now: number): number {
  if (!entry) return 0;
  const age = Math.max(0, now - Date.parse(entry.lastAt));
  return Math.min(MAX_USAGE_BOOST, USAGE_STEP * entry.count) + RECENCY_BOOST * Math.exp(-age / RECENCY_DECAY_MS);
}
