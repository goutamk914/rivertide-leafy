/** Chart interaction hooks: measuring the container width and a hover/keyboard cursor over days. */
import { useCallback, useLayoutEffect, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';

/** Moves a day cursor for a key press; null when the key is not a navigation key. */
export function stepIndex(key: string, current: number | null, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = current ?? last;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(0, from - 1);
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(last, from + 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/** Tracks an element's width (via ResizeObserver); `fallback` until it has been measured. */
export function useElementWidth(fallback: number): { readonly ref: (node: HTMLElement | null) => void; readonly width: number } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!node) return undefined;
    const measure = () => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { ref: setNode, width };
}

export interface ChartCursor {
  /** Index of the highlighted day, or null when nothing is hovered or focused. */
  readonly active: number | null;
  /** True when the cursor was moved with the keyboard (drives the live announcement). */
  readonly viaKeyboard: boolean;
  readonly handlers: {
    readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: () => void;
    readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
    readonly onBlur: () => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * A crosshair cursor that snaps to the nearest day. `indexAt` turns an x offset (px from the
 * plot element's left edge) into a day index. Arrow keys, Home and End move it from the keyboard.
 */
export function useChartCursor(count: number, indexAt: (x: number) => number): ChartCursor {
  const [active, setActive] = useState<number | null>(null);
  const [viaKeyboard, setViaKeyboard] = useState(false);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
      if (!Number.isFinite(x) || count <= 0) return;
      setViaKeyboard(false);
      setActive(indexAt(x));
    },
    [count, indexAt],
  );
  const onPointerLeave = useCallback(() => {
    if (!viaKeyboard) setActive(null);
  }, [viaKeyboard]);
  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || count <= 0) return;
      setViaKeyboard(true);
      setActive((current) => current ?? count - 1);
    },
    [count],
  );
  const onBlur = useCallback(() => {
    setViaKeyboard(false);
    setActive(null);
  }, []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const next = stepIndex(event.key, active, count);
      if (next === null) return;
      event.preventDefault();
      setViaKeyboard(true);
      setActive(next);
    },
    [active, count],
  );

  const safeActive = active !== null && active < count ? active : null;
  return { active: safeActive, viaKeyboard, handlers: { onPointerMove, onPointerLeave, onFocus, onBlur, onKeyDown } };
}
