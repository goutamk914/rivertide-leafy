import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/ipc';
import { navigate } from '../../lib/router';
import { toast } from '../../ui/components';

export type LookupStatus = 'idle' | 'loading' | 'found' | 'missing' | 'error';

export interface ItemLookup<T> {
  readonly status: LookupStatus;
  readonly item: T | null;
  readonly error: string | null;
}

const IDLE = { status: 'idle', item: null, error: null } as const;

/**
 * Looks one item up by id (for links from the palette or elsewhere) when it isn't already on screen.
 * Results are tied to the id they were fetched for, so a stale answer for another id is never used.
 */
export function useItemLookup<T>(id: string | null, enabled: boolean, load: (id: string) => Promise<T | null>): ItemLookup<T> {
  const [result, setResult] = useState<{ readonly id: string; readonly item: T | null; readonly error: string | null } | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!id || !enabled) return undefined;
    let alive = true;
    loadRef.current(id)
      .then((item) => {
        if (alive) setResult({ id, item, error: null });
      })
      .catch((err: unknown) => {
        if (alive) setResult({ id, item: null, error: errorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [id, enabled]);

  if (!id || !enabled) return IDLE;
  if (!result || result.id !== id) return { status: 'loading', item: null, error: null };
  if (result.error) return { status: 'error', item: null, error: result.error };
  return result.item ? { status: 'found', item: result.item, error: null } : { status: 'missing', item: null, error: null };
}

/**
 * When a link points at an item that no longer exists (deleted, wiped, or a stale palette result),
 * say so once and go to the page's default view instead of showing an empty or wrong item.
 */
export function useMissingItem(missing: boolean, fallbackPath: string, message: string): void {
  useEffect(() => {
    if (!missing) return;
    toast.info(message);
    navigate(fallbackPath, { replace: true });
  }, [missing, fallbackPath, message]);
}
