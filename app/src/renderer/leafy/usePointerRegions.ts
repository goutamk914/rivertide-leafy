import { useCallback, useEffect, useMemo, useState } from 'react';
import { fireAndForget } from '../lib/hooks/bridge';

export type Region = 'sprite' | 'toolbar' | 'bubble';

/** Moving between Leafy and the toolbar crosses a few transparent pixels; don't flicker click-through. */
const LEAVE_GRACE_MS = 90;

export interface RegionHandlers {
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
}

/**
 * Tracks which interactive parts of the Leafy window the pointer is over and keeps main's
 * click-through state in sync (`leafy:pointer`). The window forwards mouse moves while it ignores
 * clicks, so enter/leave still fire over the transparent desktop.
 */
export function usePointerRegions(forceInteractive: boolean) {
  const [hovered, setHovered] = useState<ReadonlySet<Region>>(() => new Set());

  const enter = useCallback((region: Region) => {
    setHovered((prev) => (prev.has(region) ? prev : new Set([...prev, region])));
  }, []);
  const leave = useCallback((region: Region) => {
    setHovered((prev) => (prev.has(region) ? new Set([...prev].filter((r) => r !== region)) : prev));
  }, []);

  const interactive = hovered.size > 0 || forceInteractive;

  /** Forget a region that unmounted under the pointer (no pointerleave fires for removed nodes). */
  const clear = leave;

  useEffect(() => {
    if (interactive) {
      fireAndForget('leafy:pointer', { interactive: true });
      return undefined;
    }
    const timer = window.setTimeout(() => fireAndForget('leafy:pointer', { interactive: false }), LEAVE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [interactive]);

  const handlers = useMemo(() => {
    const make = (region: Region): RegionHandlers => ({ onPointerEnter: () => enter(region), onPointerLeave: () => leave(region) });
    return { sprite: make('sprite'), toolbar: make('toolbar'), bubble: make('bubble') };
  }, [enter, leave]);

  return { hovered, handlers, clear };
}

/** True while `value` is true and for `ms` after it turns false (lets the pointer travel to the toolbar). */
export function useLingering(value: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(value);
  useEffect(() => {
    if (value) {
      setLingering(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setLingering(false), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return value || lingering;
}
