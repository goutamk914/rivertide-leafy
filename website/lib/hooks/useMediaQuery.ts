'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Subscribes to a media query. Returns `fallback` during prerender and hydration. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  const readServer = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, read, readServer);
}
