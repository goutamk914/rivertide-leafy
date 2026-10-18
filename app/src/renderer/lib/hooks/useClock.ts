import { useEffect, useState } from 'react';

/** Browsers clamp longer timeouts; we re-arm instead. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Pure: the earliest timestamp still in the future, or null. */
export function nextWake(candidates: readonly (number | null | undefined)[], now: number): number | null {
  let best: number | null = null;
  for (const at of candidates) {
    if (at === null || at === undefined || at <= now) continue;
    if (best === null || at < best) best = at;
  }
  return best;
}

/**
 * Returns `Date.now()` and re-renders exactly when the earliest of `wakeAt` timestamps passes —
 * no polling. Use it for bubbles that expire, idle thresholds and similar time-based UI.
 */
export function useClock(wakeAt: readonly (number | null | undefined)[]): number {
  const [now, setNow] = useState(() => Date.now());
  const target = nextWake(wakeAt, now);

  useEffect(() => {
    if (target === null) return undefined;
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, target - Date.now()) + 1);
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [target]);

  return now;
}
