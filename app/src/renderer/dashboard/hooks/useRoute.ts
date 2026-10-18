import { useMemo, useSyncExternalStore } from 'react';
import { parseRoute, subscribeRoute, type Route } from '../../lib/router';

const getHash = () => (typeof window === 'undefined' ? '' : window.location.hash);

/** The current hash route; re-renders on every route change. */
export function useRoute(): Route {
  const hash = useSyncExternalStore((notify) => subscribeRoute(() => notify()), getHash, () => '');
  return useMemo(() => parseRoute(hash), [hash]);
}
