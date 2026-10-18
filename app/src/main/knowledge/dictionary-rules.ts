/**
 * Pure dictionary logic. `applyDictionary` replaces known mis-hearings with the correct term in
 * one deterministic pass: word-boundary, case-insensitive, longest phrase first, surrounding
 * punctuation untouched, and a replaced word is never re-replaced.
 */
import type { DictionaryEntry, Id } from '../../shared/types';

export const DICTIONARY_CAP = 2000;
export const MAX_REPLACES = 20;
/** Keeps the combined regex well below V8's size limit; most-used entries win. */
export const MAX_MATCHER_PHRASES = 5000;
const MAX_PHRASE = 80;

export interface DictionaryMatcher {
  readonly regex: RegExp | null;
  readonly lookup: ReadonlyMap<string, { readonly term: string; readonly entryId: Id }>;
}

const normalizePhrase = (phrase: string): string => phrase.toLowerCase().replace(/[\s-]+/g, ' ').trim();
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sanitizeReplaces(term: string, replaces: readonly string[]): string[] {
  const termKey = normalizePhrase(term);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const phrase of replaces) {
    const clean = phrase.replace(/\s+/g, ' ').trim().slice(0, MAX_PHRASE);
    const key = normalizePhrase(clean);
    if (!key || key === termKey || seen.has(key)) continue;
    seen.add(key);
    kept.push(clean);
    if (kept.length >= MAX_REPLACES) break;
  }
  return kept;
}

export function buildMatcher(entries: readonly DictionaryEntry[], maxPhrases: number = MAX_MATCHER_PHRASES): DictionaryMatcher {
  const lookup = new Map<string, { term: string; entryId: Id }>();
  const byUse = [...entries].sort((a, b) => b.uses - a.uses || b.createdAt.localeCompare(a.createdAt));
  for (const entry of byUse) {
    for (const phrase of entry.replaces) {
      const key = normalizePhrase(phrase);
      if (key && !lookup.has(key) && lookup.size < maxPhrases) lookup.set(key, { term: entry.term, entryId: entry.id });
    }
  }
  if (lookup.size === 0) return { regex: null, lookup };
  const alternatives = [...lookup.keys()]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map((key) => key.split(' ').map(escapeRegex).join('[\\s-]+'));
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return { regex, lookup };
}

const startsUpper = (text: string): boolean => /^\p{Lu}/u.test(text);

export function applyDictionary(text: string, matcher: DictionaryMatcher): { text: string; used: ReadonlyMap<Id, number> } {
  const used = new Map<Id, number>();
  if (!matcher.regex || !text) return { text, used };
  const replaced = text.replace(matcher.regex, (match) => {
    const hit = matcher.lookup.get(normalizePhrase(match));
    if (!hit) return match;
    used.set(hit.entryId, (used.get(hit.entryId) ?? 0) + 1);
    const keepCapital = startsUpper(match) && !startsUpper(hit.term);
    return keepCapital ? `${hit.term[0].toUpperCase()}${hit.term.slice(1)}` : hit.term;
  });
  return { text: replaced, used };
}

/** Most-used first, then newest; one entry per distinct term. */
export function rankTerms(entries: readonly DictionaryEntry[], limit: number): string[] {
  const sorted = [...entries].sort((a, b) => b.uses - a.uses || b.createdAt.localeCompare(a.createdAt));
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const entry of sorted) {
    const key = entry.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(entry.term);
    if (terms.length >= limit) break;
  }
  return terms;
}

/** Drops the oldest learned entries first (then the oldest manual ones) until under `cap`. */
export function evictOverCap(entries: readonly DictionaryEntry[], cap: number = DICTIONARY_CAP): DictionaryEntry[] {
  const overflow = entries.length - cap;
  if (overflow <= 0) return [...entries];
  const byAge = (a: DictionaryEntry, b: DictionaryEntry): number => a.createdAt.localeCompare(b.createdAt);
  const victims = [
    ...entries.filter((entry) => entry.source === 'learned').sort(byAge),
    ...entries.filter((entry) => entry.source === 'manual').sort(byAge),
  ].slice(0, overflow);
  const drop = new Set(victims.map((entry) => entry.id));
  return entries.filter((entry) => !drop.has(entry.id));
}
