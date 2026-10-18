/**
 * Small data hooks for the dashboard. (Another agent may ship shared hooks in lib/hooks; these stay
 * local so the dashboard has no ordering dependency on that work.)
 */
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { EventChannel } from '@shared/ipc-channels';
import type { EventPayload } from '@shared/ipc';
import type { DataDomain } from '@shared/types';
import { errorMessage, on } from '../../lib/ipc';

/** Subscribes to a main-process event for the component's lifetime. The listener can change freely. */
export function useIpcEvent<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): void {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  }, [listener]);
  useEffect(() => on(channel, (payload) => ref.current(payload)), [channel]);
}

export interface QueryState<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  /** True only before the first result arrives (refetches keep the old data on screen). */
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly reload: () => void;
  /** Local optimistic edit of the cached data. */
  readonly mutate: (update: (current: T | undefined) => T | undefined) => void;
}

/**
 * Loads data through IPC, reloads when `deps` change or when main reports a change in one of
 * `domains`. Previous data stays visible while refetching (no skeleton flash).
 */
export function useIpcQuery<T>(load: () => Promise<T>, deps: DependencyList, domains: readonly DataDomain[] = []): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let alive = true;
    setRefreshing(true);
    loadRef.current()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-provided deps drive reloads
  }, [...deps, version]);

  const domainKey = domains.join(',');
  useIpcEvent('data:changed', ({ domain }) => {
    if (domainKey.split(',').includes(domain)) setVersion((v) => v + 1);
  });

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const mutate = useCallback((update: (current: T | undefined) => T | undefined) => setData((current) => update(current)), []);
  return { data, error, loading, refreshing, reload, mutate };
}

/** A clock that re-renders every `intervalMs` (for greetings and relative times). */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Value that only updates after `delayMs` of quiet (search boxes). */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
