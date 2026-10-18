/**
 * Pure fact logic: dedupe (same category + label token Jaccard ≥ 0.6), merging extracted facts,
 * ordering, and prompt relevance (pinned first, then BM25).
 */
import type { Fact, FactCategory, FactSource, Id } from '../../shared/types';
import { corpusStats, rank, toBm25Doc } from './bm25';
import type { ExtractedFact } from './extract';
import { labelSimilarity, tokenize } from './text';

export const DEDUPE_THRESHOLD = 0.6;

/** Facts the user wrote or pinned themselves are never overwritten by automatic extraction. */
export function isUserProtected(fact: Fact): boolean {
  return fact.pinned || fact.source === 'manual' || fact.source === 'onboarding';
}

export function sortFacts(facts: readonly Fact[]): Fact[] {
  return [...facts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** The most similar fact in the same category, if it clears the dedupe threshold. */
export function findDuplicate(facts: readonly Fact[], category: FactCategory, label: string, excludeId?: Id): Fact | null {
  let best: { fact: Fact; similarity: number } | null = null;
  for (const fact of facts) {
    if (fact.category !== category || fact.id === excludeId) continue;
    const similarity = labelSimilarity(fact.label, label);
    if (similarity >= DEDUPE_THRESHOLD && (!best || similarity > best.similarity)) best = { fact, similarity };
  }
  return best?.fact ?? null;
}

export interface MergeOptions {
  readonly source: FactSource;
  readonly sourceRef: Id | null;
  readonly now: string;
  readonly makeId: () => Id;
}

/** Adds extracted facts, updating near-duplicates in place. Returns the new list and what changed. */
export function mergeExtracted(existing: readonly Fact[], extracted: readonly ExtractedFact[], options: MergeOptions): { facts: Fact[]; changed: Fact[] } {
  let facts = [...existing];
  const changed = new Map<Id, Fact>();
  for (const candidate of extracted) {
    const duplicate = findDuplicate(facts, candidate.category, candidate.label);
    if (duplicate) {
      if (isUserProtected(duplicate)) continue;
      if (duplicate.value.trim().toLowerCase() === candidate.value.trim().toLowerCase()) continue;
      const updated: Fact = { ...duplicate, value: candidate.value, updatedAt: options.now };
      facts = facts.map((fact) => (fact.id === duplicate.id ? updated : fact));
      changed.set(updated.id, updated);
      continue;
    }
    const created: Fact = {
      id: options.makeId(),
      category: candidate.category,
      label: candidate.label,
      value: candidate.value,
      source: options.source,
      sourceRef: options.sourceRef,
      pinned: false,
      createdAt: options.now,
      updatedAt: options.now,
    };
    facts = [created, ...facts];
    changed.set(created.id, created);
  }
  return { facts, changed: [...changed.values()] };
}

const factText = (fact: Fact): string => `${fact.label} ${fact.value} ${fact.category}`;

/** Pinned facts first, then the best BM25 matches for `query`, up to `limit` in total. */
export function rankRelevant(facts: readonly Fact[], query: string, limit: number): Fact[] {
  if (limit <= 0) return [];
  const pinned = sortFacts(facts.filter((fact) => fact.pinned)).slice(0, limit);
  const rest = facts.filter((fact) => !fact.pinned);
  const docs = rest.map((fact) => toBm25Doc(fact, tokenize(factText(fact))));
  const ranked = rank(docs, tokenize(query), corpusStats([docs]));
  return [...pinned, ...ranked.map((entry) => entry.doc.meta)].slice(0, limit);
}

export function filterFacts(facts: readonly Fact[], query?: string, category?: FactCategory): Fact[] {
  const needle = query?.trim().toLowerCase() ?? '';
  return sortFacts(facts.filter((fact) => {
    if (category && fact.category !== category) return false;
    if (!needle) return true;
    return `${fact.label}\n${fact.value}`.toLowerCase().includes(needle);
  }));
}
