/**
 * Leafy palette: merges providers in parallel (each under its own time budget), dedupes, ranks
 * with usage/recency boosts, and caches the last 200 results' actions so the renderer only ever
 * sends back an id. Unknown ids are rejected.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { SearchResult } from '../../shared/types';
import type { AppContext, PaletteService } from '../services';
import { errorMessage, lazyLogger, lazyStore } from '../data/store';
import { findCommand } from './commands';
import {
  appCandidates, askAndWebCandidates, commandCandidates, fileCandidates, memoryCandidates, reminderCandidates, settleAsk, withTimeout,
  type Candidate, type PaletteAction,
} from './providers';
import { usageBoost, type UsageEntry } from './scoring';

export const ACTION_CACHE_SIZE = 200;
export const USAGE_CAP = 300;
export const BUDGET_MS = { apps: 400, files: 700, memory: 300, icons: 250 } as const;
const VOICE_HANDOFF_MS = 150;
const CONFIRM_HOLD_MS = 5000;
const DEFAULT_LIMIT = 12;

const UsageFileSchema = z.object({
  version: z.literal(1),
  usage: z.record(z.string().max(64), z.object({ count: z.number().int().nonnegative(), lastAt: z.string().max(40) })),
});
type UsageFile = z.infer<typeof UsageFileSchema>;

const TIMED_OUT = Symbol('timed-out');
const EXPIRED = 'That result is no longer available. Please search again.';
const FAILED = "Leafy couldn't do that just now. Please try again.";

export function mergeCandidates(groups: readonly (readonly Candidate[])[], usage: UsageFile['usage'], now: number, limit: number): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const entry of groups.flat()) {
    const boosted = { ...entry, score: entry.score + usageBoost(usage[entry.result.id] as UsageEntry | undefined, now) };
    const existing = best.get(entry.result.id);
    if (!existing || boosted.score > existing.score) best.set(entry.result.id, boosted);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function createPaletteService(ctx: AppContext): PaletteService {
  const log = lazyLogger(ctx, 'palette');
  const store = lazyStore<UsageFile>(ctx, 'palette', { version: 1, usage: {} }, (raw) => UsageFileSchema.parse(raw));
  const actions = new Map<string, PaletteAction>();

  const guard = async (name: string, budgetMs: number, run: () => Promise<Candidate[]> | Candidate[]): Promise<Candidate[]> => {
    try {
      const result = await withTimeout<Candidate[] | typeof TIMED_OUT>(Promise.resolve().then(run), budgetMs, TIMED_OUT);
      if (result !== TIMED_OUT) return result;
      log().debug('Palette provider ran out of time', { provider: name, budgetMs });
      return [];
    } catch (error) {
      log().warn('Palette provider failed', { provider: name, error: errorMessage(error) });
      return [];
    }
  };

  const remember = (results: readonly Candidate[]): void => {
    for (const { result, action } of results) {
      actions.delete(result.id);
      actions.set(result.id, action);
    }
    while (actions.size > ACTION_CACHE_SIZE) actions.delete(actions.keys().next().value as string);
  };

  const recordUse = (id: string): void => {
    store().update((current) => {
      const previous = current.usage[id];
      const entries = Object.entries({ ...current.usage, [id]: { count: (previous?.count ?? 0) + 1, lastAt: new Date().toISOString() } })
        .sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt))
        .slice(0, USAGE_CAP);
      return { version: 1, usage: Object.fromEntries(entries) };
    });
  };

  const perform = async (action: PaletteAction, alt: boolean): Promise<{ message: string | null; keepOpen: boolean }> => {
    switch (action.type) {
      case 'app':
        await ctx.os.apps.open(action.entry);
        return { message: null, keepOpen: false };
      case 'file':
        if (alt) ctx.os.files.reveal(action.path);
        else await ctx.os.files.open(action.path);
        return { message: null, keepOpen: false };
      case 'route':
        ctx.windows.dashboard.show(action.route);
        return { message: null, keepOpen: false };
      case 'ask':
        ctx.agent.ask(action.text, 'palette');
        return { message: null, keepOpen: true };
      case 'web':
        await ctx.os.webSearch(action.query);
        return { message: null, keepOpen: false };
      case 'command':
        return { message: await runCommand(action.commandId), keepOpen: false };
    }
  };

  const runCommand = async (commandId: string): Promise<string | null> => {
    const command = findCommand(commandId);
    if (!command?.run) throw new Error(`Unknown palette command ${commandId}`);
    if (command.hideFirst) {
      ctx.windows.palette.hide();
      await delay(VOICE_HANDOFF_MS);
    }
    return command.run(ctx);
  };

  return {
    async search(query, limit = DEFAULT_LIMIT) {
      const now = Date.now();
      const groups = await Promise.all([
        guard('commands', BUDGET_MS.memory, () => commandCandidates(ctx, query)),
        guard('apps', BUDGET_MS.apps, () => appCandidates(ctx, query, BUDGET_MS.icons)),
        guard('files', BUDGET_MS.files, () => fileCandidates(ctx, query)),
        guard('memory', BUDGET_MS.memory, () => (query.trim() ? memoryCandidates(ctx, query) : [])),
        guard('reminders', BUDGET_MS.memory, () => reminderCandidates(ctx, query, now)),
        guard('ask', BUDGET_MS.memory, () => askAndWebCandidates(query)),
      ]);
      const ranked = mergeCandidates([settleAsk(groups.flat())], store().read().usage, now, Math.max(1, limit));
      remember(ranked);
      return ranked.map((entry): SearchResult => ({ ...entry.result, score: Math.round(entry.score * 1000) / 1000 }));
    },

    async execute(id, alt) {
      const action = actions.get(id);
      if (!action) {
        log().warn('Palette execute with an unknown id', { id });
        return { ok: false, message: EXPIRED };
      }
      try {
        recordUse(id);
        const { message, keepOpen } = await perform(action, alt);
        if (!keepOpen) ctx.windows.palette.hide();
        // The palette closes, so confirmations ("Timer set for 5 minutes.") also go to Leafy's bubble.
        if (message && !keepOpen) ctx.bus.emit('leafy:cue', { mood: 'success', say: message, holdMs: CONFIRM_HOLD_MS });
        return { ok: true, message };
      } catch (error) {
        log().error('Palette action failed', { id, type: action.type, error: errorMessage(error) });
        return { ok: false, message: FAILED };
      }
    },
  };
}
