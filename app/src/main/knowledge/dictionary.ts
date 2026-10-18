/**
 * Personal dictionary: correct spellings of names and medical terms plus the mis-hearings they
 * replace. Feeds STT prompts (`terms`), deterministic fixes (`apply`) and learns conservatively.
 */
import type { DictionaryEntry, Id } from '../../shared/types';
import type { AppContext, DictionaryService } from '../services';
import { newId, nowIso } from '../data/ids';
import { DictionaryEntrySchema } from '../data/schemas';
import { announceChange, errorMessage, lazyLogger, lazyStore, parseItems } from '../data/store';
import { buildLearnUserMessage, LEARN_MAX_TOKENS, LEARN_SYSTEM_PROMPT, parseLearnedTerms, worthLearning } from './dictionary-learn';
import { applyDictionary, buildMatcher, evictOverCap, rankTerms, sanitizeReplaces, type DictionaryMatcher } from './dictionary-rules';

interface DictionaryFile { readonly version: 1; readonly entries: readonly DictionaryEntry[] }

const LEARN_TIMEOUT_MS = 20_000;
const LEARNED_MEMORY = 200;

export function createDictionaryService(ctx: AppContext): DictionaryService {
  const log = lazyLogger(ctx, 'dictionary');
  const store = lazyStore<DictionaryFile>(ctx, 'dictionary', { version: 1, entries: [] }, (raw) => ({
    version: 1,
    entries: parseItems(raw, 'entries', DictionaryEntrySchema, log),
  }));
  let revision = 0;
  let matcher: { readonly revision: number; readonly value: DictionaryMatcher } | null = null;
  const seenPairs = new Set<string>();

  const entries = (): readonly DictionaryEntry[] => store().read().entries;
  /** `phrasesChanged: false` (use counts only) keeps the compiled matcher — no rebuild on the paste path. */
  const write = (next: readonly DictionaryEntry[], phrasesChanged = true): void => {
    store().write({ version: 1, entries: evictOverCap(next) });
    if (phrasesChanged) revision += 1;
    announceChange(ctx, 'dictionary');
  };
  const currentMatcher = (): DictionaryMatcher => {
    if (matcher?.revision !== revision) matcher = { revision, value: buildMatcher(entries()) };
    return matcher.value;
  };

  const upsert: DictionaryService['upsert'] = (input, source = 'manual') => {
    const current = entries();
    const term = input.term.replace(/\s+/g, ' ').trim();
    const byId = input.id ? current.find((entry) => entry.id === input.id) : undefined;
    const target = byId ?? current.find((entry) => entry.term.toLowerCase() === term.toLowerCase());
    if (target) {
      const replaces = byId ? input.replaces : [...target.replaces, ...input.replaces];
      const updated: DictionaryEntry = {
        ...target,
        term,
        replaces: sanitizeReplaces(term, replaces),
        note: input.note?.trim() ?? target.note,
        source: source === 'manual' ? 'manual' : target.source,
      };
      write(current.map((entry) => (entry.id === target.id ? updated : entry)));
      return updated;
    }
    const created: DictionaryEntry = {
      id: newId(), term, replaces: sanitizeReplaces(term, input.replaces), note: input.note?.trim() ?? '',
      source, uses: 0, createdAt: nowIso(),
    };
    write([created, ...current]);
    return created;
  };

  const recordUses = (used: ReadonlyMap<Id, number>): void => {
    if (used.size === 0) return;
    write(entries().map((entry) => (used.has(entry.id) ? { ...entry, uses: entry.uses + (used.get(entry.id) ?? 0) } : entry)), false);
  };

  const firstTime = (raw: string, polished: string): boolean => {
    const key = `${raw.length}:${polished.length}:${raw.slice(0, 80)}|${polished.slice(0, 80)}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    if (seenPairs.size > LEARNED_MEMORY) seenPairs.delete(seenPairs.values().next().value as string);
    return true;
  };

  const learn = async (raw: string, polished: string): Promise<void> => {
    const result = await ctx.llm.complete('extract', {
      system: LEARN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildLearnUserMessage(raw, polished) }],
      maxTokens: LEARN_MAX_TOKENS,
      json: true,
      signal: AbortSignal.timeout(LEARN_TIMEOUT_MS),
    });
    const learned = parseLearnedTerms(result.text, raw, polished);
    if (learned === null) {
      log().warn('Dictionary learning reply was not valid JSON', { chars: result.text.length });
      return;
    }
    for (const candidate of learned) upsert({ term: candidate.term, replaces: [candidate.heard] }, 'learned');
    if (learned.length > 0) log().info('Learned dictionary terms', { count: learned.length });
  };

  return {
    list: () => [...entries()].sort((a, b) => a.term.localeCompare(b.term)),
    upsert,

    delete(id) {
      const current = entries();
      const kept = current.filter((entry) => entry.id !== id);
      if (kept.length !== current.length) write(kept);
    },

    terms: (limit) => rankTerms(entries(), Math.max(0, limit)),

    apply(text) {
      try {
        const result = applyDictionary(text, currentMatcher());
        recordUses(result.used);
        return result.text;
      } catch (error) {
        log().error('Dictionary replacement failed; text left unchanged', { error: errorMessage(error) });
        return text;
      }
    },

    async learnFrom(raw, polished) {
      try {
        if (!ctx.settings.get().knowledge.learnDictionary) return;
        if (!worthLearning(raw, polished) || !ctx.llm.isConfigured('extract')) return;
        if (!firstTime(raw, polished)) return;
        await learn(raw, polished);
      } catch (error) {
        log().warn('Dictionary learning failed', { error: errorMessage(error) });
      }
    },
  };
}
