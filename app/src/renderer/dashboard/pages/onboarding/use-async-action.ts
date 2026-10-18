import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../lib/ipc';

export interface AsyncAction {
  readonly pending: boolean;
  readonly error: string | null;
  /**
   * Runs `task` with pending/error bookkeeping. A rejection becomes `describe(detail)`; resolves to the
   * task's value, or undefined when it failed. Safe to call from a component that may unmount mid-flight.
   */
  readonly run: <T>(task: () => Promise<T>, describe: (detail: string) => string) => Promise<T | undefined>;
  readonly clearError: () => void;
  /** False once the component unmounted (e.g. the person pressed Back while a save was in flight). */
  readonly isMounted: () => boolean;
}

/** Pending + error state for one button's async work (save, test, allow…). */
export function useAsyncAction(): AsyncAction {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(task: () => Promise<T>, describe: (detail: string) => string): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await task();
    } catch (err) {
      if (alive.current) setError(describe(errorMessage(err)));
      return undefined;
    } finally {
      if (alive.current) setPending(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const isMounted = useCallback(() => alive.current, []);
  return { pending, error, run, clearError, isMounted };
}
