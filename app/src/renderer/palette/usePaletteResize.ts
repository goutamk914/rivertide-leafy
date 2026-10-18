import { useEffect, type RefObject } from 'react';
import { fireAndForget } from '../lib/hooks/bridge';

/** Transparent space around the card for its shadow, px (each side). Must match palette.css. */
export const PALETTE_GUTTER = 16;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 720;

/** Window height for a card of `cardHeight`, clamped to what `palette:resize` accepts. */
export function windowHeightFor(cardHeight: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(cardHeight + PALETTE_GUTTER * 2)));
}

/** Watches the card and asks main to fit the window to it (once per frame, only on change). */
export function usePaletteResize(cardRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === 'undefined') return undefined;
    let last = 0;
    let frame = 0;
    const report = () => {
      frame = 0;
      const height = windowHeightFor(card.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      fireAndForget('palette:resize', { height });
    };
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(report);
    });
    observer.observe(card);
    report();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [cardRef]);
}
