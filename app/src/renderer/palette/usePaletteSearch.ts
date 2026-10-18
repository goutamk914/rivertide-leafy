import { useEffect, useRef, useState } from 'react';
import type { SearchResult } from '@shared/types';
import { errorMessage } from '../lib/ipc';
import { reportError, safeInvoke } from '../lib/hooks/bridge';

export const SEARCH_DEBOUNCE_MS = 60;
const SEARCH_LIMIT = 40;

export interface SearchState {
  /** The query these results belong to (results stay on screen while the next query loads). */
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly loading: boolean;
  readonly error: string | null;
}

const EMPTY: SearchState = { query: '', results: [], loading: false, error: null };

/**
 * Debounced `palette:search`. Keeps the previous results visible until the next answer arrives
 * (no flashing, no layout jump) and ignores answers that come back out of order.
 */
export function usePaletteSearch(query: string, enabled: boolean): SearchState {
  const [state, setState] = useState<SearchState>(EMPTY);
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed === '') {
      latest.current += 1;
      setState(EMPTY);
      return undefined;
    }
    setState((prev) => ({ ...prev, loading: true }));
    const timer = window.setTimeout(() => {
      latest.current += 1;
      const ticket = latest.current;
      safeInvoke('palette:search', { query: trimmed, limit: SEARCH_LIMIT })
        .then((results) => {
          if (ticket === latest.current) setState({ query: trimmed, results, loading: false, error: null });
        })
        .catch((error: unknown) => {
          reportError('palette:search', error);
          if (ticket === latest.current) setState({ query: trimmed, results: [], loading: false, error: errorMessage(error) });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, enabled]);

  return state;
}
