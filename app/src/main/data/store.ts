/**
 * Small helpers every memory service shares:
 *  - `lazyStore` opens a JSON store on first use (factories may only store `ctx`).
 *  - `collectionValidator` validates `{ version: 1, <key>: T[] }` files item by item, so one bad
 *    record is dropped (and logged) instead of losing the whole file. A file whose overall shape
 *    is wrong throws, letting the core store restore its `.bak` copy.
 *  - `announceChange` emits `data:changed` and invalidates the search index.
 */
import { z } from 'zod';
import type { DataDomain } from '../../shared/types';
import type { AppContext, JsonStore, Logger } from '../services';

export type Collection<K extends string, T> = { readonly version: 1 } & { readonly [P in K]: readonly T[] };

export function lazy<T>(make: () => T): () => T {
  let value: { readonly current: T } | null = null;
  return () => {
    if (value === null) value = { current: make() };
    return value.current;
  };
}

export function lazyLogger(ctx: AppContext, scope: string): () => Logger {
  return lazy(() => ctx.logger.child(scope));
}

export function lazyStore<T>(
  ctx: AppContext,
  name: string,
  defaults: T,
  validate: (raw: unknown) => T,
): () => JsonStore<T> {
  return lazy(() => ctx.openStore<T>(name, { defaults, validate }));
}

const envelope = (key: string) => z.object({ version: z.literal(1), [key]: z.array(z.unknown()) });

/**
 * Parses the item array of a collection file. Invalid items are skipped with a warning.
 * Throws when the file is not a version-1 collection at all.
 */
export function parseItems<T>(raw: unknown, key: string, item: z.ZodType<T>, log: () => Logger): T[] {
  const parsed = envelope(key).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Stored ${key} file is not a valid version 1 collection.`);
  }
  const values = (parsed.data as Record<string, unknown[]>)[key];
  const kept: T[] = [];
  let dropped = 0;
  for (const value of values) {
    const result = item.safeParse(value);
    if (result.success) kept.push(result.data);
    else dropped += 1;
  }
  if (dropped > 0) log().warn('Dropped invalid stored records', { key, dropped, kept: kept.length });
  return kept;
}

export function announceChange(ctx: AppContext, domain: DataDomain): void {
  ctx.search.invalidate(domain);
  ctx.bus.emit('data:changed', { domain });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Collapses whitespace and cuts to `max` characters on a word boundary, adding an ellipsis. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace >= max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,.;:!?-]+$/, '')}…`;
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).length;
}
