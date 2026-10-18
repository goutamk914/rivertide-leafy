/**
 * Knowledge service: durable facts about the user's health journey and life.
 * Facts come from manual edits, the agent, and background extraction from the user's own words.
 */
import type { Fact, HistoryItem, Id } from '../../shared/types';
import type { AppContext, KnowledgeService } from '../services';
import { newId, nowIso } from '../data/ids';
import { FactSchema } from '../data/schemas';
import { announceChange, countWords, errorMessage, lazyLogger, lazyStore, parseItems } from '../data/store';
import {
  buildExtractUserMessage, EXTRACT_MAX_TOKENS, EXTRACT_SYSTEM_PROMPT, MIN_EXTRACT_WORDS, parseExtractedFacts,
} from './extract';
import { filterFacts, findDuplicate, mergeExtracted, rankRelevant } from './facts';
import { buildGraph } from './graph';

interface KnowledgeFile { readonly version: 1; readonly facts: readonly Fact[] }

export const FACTS_CAP = 3000;
const KNOWN_FACTS_IN_PROMPT = 20;
const PROCESSED_MEMORY = 500;
const EXTRACT_TIMEOUT_MS = 30_000;

export function shouldExtract(item: HistoryItem): boolean {
  return item.status === 'ok' && countWords(item.raw) >= MIN_EXTRACT_WORDS;
}

export function createKnowledgeService(ctx: AppContext): KnowledgeService {
  const log = lazyLogger(ctx, 'knowledge');
  const store = lazyStore<KnowledgeFile>(ctx, 'knowledge', { version: 1, facts: [] }, (raw) => ({
    version: 1,
    facts: parseItems(raw, 'facts', FactSchema, log),
  }));
  const processed = new Set<Id>();

  const facts = (): readonly Fact[] => store().read().facts;
  const write = (next: readonly Fact[]): void => {
    store().write({ version: 1, facts: next.slice(0, FACTS_CAP) });
    announceChange(ctx, 'knowledge');
  };

  const remember = (id: Id): boolean => {
    if (processed.has(id)) return false;
    processed.add(id);
    if (processed.size > PROCESSED_MEMORY) processed.delete(processed.values().next().value as Id);
    return true;
  };

  const runExtraction = async (item: HistoryItem): Promise<readonly Fact[]> => {
    const result = await ctx.llm.complete('extract', {
      system: EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildExtractUserMessage(item.raw, rankRelevant(facts(), item.raw, KNOWN_FACTS_IN_PROMPT)) }],
      maxTokens: EXTRACT_MAX_TOKENS,
      json: true,
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });
    const extracted = parseExtractedFacts(result.text);
    if (extracted === null) {
      log().warn('Fact extraction reply was not valid JSON', { historyId: item.id, chars: result.text.length });
      return [];
    }
    if (extracted.length === 0) return [];
    const merged = mergeExtracted(facts(), extracted, { source: 'dictation', sourceRef: item.id, now: nowIso(), makeId: () => newId() });
    if (merged.changed.length > 0) {
      write(merged.facts);
      log().info('Remembered facts from a dictation', { historyId: item.id, count: merged.changed.length });
    }
    return merged.changed;
  };

  return {
    list: (query) => filterFacts(facts(), query?.query, query?.category),

    upsert(input, source = 'manual') {
      const current = facts();
      const now = nowIso();
      const target = input.id
        ? current.find((fact) => fact.id === input.id)
        : findDuplicate(current, input.category, input.label) ?? undefined;
      if (target) {
        const updated: Fact = {
          ...target,
          category: input.category,
          label: input.label.trim(),
          value: input.value.trim(),
          pinned: input.pinned ?? target.pinned,
          updatedAt: now,
        };
        write(current.map((fact) => (fact.id === target.id ? updated : fact)));
        return updated;
      }
      const created: Fact = {
        id: newId(), category: input.category, label: input.label.trim(), value: input.value.trim(), source,
        sourceRef: null, pinned: input.pinned ?? false, createdAt: now, updatedAt: now,
      };
      write([created, ...current]);
      return created;
    },

    delete(id) {
      const current = facts();
      const kept = current.filter((fact) => fact.id !== id);
      if (kept.length !== current.length) write(kept);
    },

    graph: () => buildGraph(facts()),
    relevant: (query, limit) => rankRelevant(facts(), query, limit),

    async extractFrom(item) {
      try {
        if (!ctx.settings.get().knowledge.autoExtract || !shouldExtract(item)) return [];
        if (!ctx.llm.isConfigured('extract')) return [];
        if (!remember(item.id)) return [];
        return await runExtraction(item);
      } catch (error) {
        log().warn('Fact extraction failed', { historyId: item.id, error: errorMessage(error) });
        return [];
      }
    },
  };
}
