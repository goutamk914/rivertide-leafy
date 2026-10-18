'use client';

import { useLayoutEffect, useState } from 'react';

/** Rough width per character before the web font has loaded. */
const FALLBACK_CHAR_WIDTH = 7.2;

let measureContext: CanvasRenderingContext2D | null = null;

function measure(text: string, font: string): number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * FALLBACK_CHAR_WIDTH;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

/**
 * Width of a label in a given CSS font shorthand, re-measured once web fonts are ready.
 * Lets the island size its stretched pill to the chapter name instead of guessing.
 */
export function useTextWidth(text: string, font: string): number {
  const [width, setWidth] = useState(() => text.length * FALLBACK_CHAR_WIDTH);

  // Measured before paint, so the island never draws a frame at the guessed width.
  useLayoutEffect(() => {
    let cancelled = false;
    setWidth(Math.ceil(measure(text, font)));
    document.fonts?.ready
      .then(() => {
        if (!cancelled) setWidth(Math.ceil(measure(text, font)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [text, font]);

  return width;
}
