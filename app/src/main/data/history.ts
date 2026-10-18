/**
 * History repository: every dictation, ask and command, newest first.
 * Cap 5000 items. Retention (`settings.privacy.retentionDays`, 0 = forever) is enforced on first
 * access and then at most once a day (or whenever the setting changes) on later accesses.
 * When `settings.privacy.historyEnabled` is off, new items are not stored.
 */
import type { HistoryItem, Id } from '../../shared/types';
import type { AppContext, HistoryQuery, HistoryRepository } from '../services';
import { HistoryItemSchema } from './schemas';
import { announceChange, lazyLogger, lazyStore, parseItems } from './store';

export const HISTORY_CAP = 5000;
export const DEFAULT_HISTORY_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

interface HistoryFile { readonly version: 1; readonly items: readonly HistoryItem[] }

const byNewest = (a: HistoryItem, b: HistoryItem): number => b.createdAt.localeCompare(a.createdAt);

export function filterHistory(items: readonly HistoryItem[], query: HistoryQuery): readonly HistoryItem[] {
  const needle = query.query?.trim().toLowerCase() ?? '';
  const limit = Math.max(1, query.limit ?? DEFAULT_HISTORY_LIMIT);
  const matches = items.filter((item) => {
    if (query.mode && item.mode !== query.mode) return false;
    if (query.before && !(item.createdAt < query.before)) return false;
    if (needle && !`${item.raw}\n${item.output}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  return matches.slice(0, limit);
}

export function applyRetention(items: readonly HistoryItem[], retentionDays: number, now: number): readonly HistoryItem[] {
  if (retentionDays <= 0) return items;
  const cutoff = new Date(now - retentionDays * DAY_MS).toISOString();
  return items.filter((item) => item.createdAt >= cutoff);
}

export function createHistoryRepository(ctx: AppContext): HistoryRepository {
  const log = lazyLogger(ctx, 'history');
  const store = lazyStore<HistoryFile>(ctx, 'history', { version: 1, items: [] }, (raw) => ({
    version: 1,
    items: parseItems(raw, 'items', HistoryItemSchema, log).sort(byNewest).slice(0, HISTORY_CAP),
  }));
  let lastPrune: { readonly at: number; readonly days: number } | null = null;

  const write = (items: readonly HistoryItem[]): void => {
    store().write({ version: 1, items });
    announceChange(ctx, 'history');
  };

  /** Applies retention when it has not run today or the setting changed. */
  const items = (): readonly HistoryItem[] => {
    const current = store().read().items;
    const days = ctx.settings.get().privacy.retentionDays;
    const now = Date.now();
    if (lastPrune && lastPrune.days === days && now - lastPrune.at < DAY_MS) return current;
    lastPrune = { at: now, days };
    const kept = applyRetention(current, days, now);
    if (kept.length === current.length) return current;
    log().info('Removed history past the retention period', { removed: current.length - kept.length, days });
    write(kept);
    return kept;
  };

  const findIndex = (id: Id): number => items().findIndex((item) => item.id === id);

  return {
    list: (query) => filterHistory(items(), query),
    recent: (limit) => items().slice(0, Math.max(0, limit)),
    get: (id) => items().find((item) => item.id === id) ?? null,

    add(item) {
      if (!ctx.settings.get().privacy.historyEnabled) {
        log().debug('History is turned off; item not stored', { id: item.id });
        return;
      }
      const rest = items().filter((existing) => existing.id !== item.id);
      write([item, ...rest].sort(byNewest).slice(0, HISTORY_CAP));
    },

    update(id, patch) {
      const index = findIndex(id);
      if (index < 0) return null;
      const current = items();
      const next: HistoryItem = { ...current[index], ...patch, id: current[index].id, createdAt: current[index].createdAt };
      write(current.map((item, i) => (i === index ? next : item)));
      return next;
    },

    delete(id) {
      const current = items();
      const kept = current.filter((item) => item.id !== id);
      if (kept.length !== current.length) write(kept);
    },

    clear() {
      write([]);
    },
  };
}
