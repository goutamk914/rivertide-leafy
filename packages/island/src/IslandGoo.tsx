'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useMotionValueEvent } from 'motion/react';
import { GOO_BLUR_REST, GOO_MATRIX, SPLIT_GAP, gooLayout, type IslandTiming } from './geometry';
import type { IslandMode } from './types';

interface IslandGooProps {
  readonly mode: IslandMode;
  /** Pill height in split. */
  readonly height: number;
  readonly bubble: number;
  readonly timing: IslandTiming;
  readonly filterId: string;
}

/** Hidden behind the capsule except in split; faded out late while a large card is open. */
const HIDE_IN_LARGE_DELAY = 0.3;

/**
 * The gooey split: a fixed circle inside the pill's rounded end and a rounded rect that slides out
 * to become the bubble. Both sit under one SVG filter (blur + alpha threshold), so while the blur is
 * high they melt together, and as the blur drops to 0 the bubble snaps off as a clean circle.
 */
export function IslandGoo({ mode, height, bubble, timing, filterId }: IslandGooProps) {
  const layout = gooLayout(height, bubble);
  const isSplit = mode === 'split';
  // The attribute is only seeded once; after that the motion value owns it, so React never
  // snaps it to the target mid-animation.
  const [initialBlur] = useState(isSplit ? 0 : GOO_BLUR_REST);
  const blur = useMotionValue(initialBlur);
  const blurRef = useRef<SVGFEGaussianBlurElement>(null);

  useMotionValueEvent(blur, 'change', (value) => {
    blurRef.current?.setAttribute('stdDeviation', value.toFixed(2));
  });

  const { to, duration, delay } = timing.goo;
  useEffect(() => {
    const controls = animate(blur, to, { duration, delay, ease: 'linear' });
    return () => controls.stop();
  }, [blur, to, duration, delay]);

  return (
    <motion.svg
      aria-hidden="true"
      focusable="false"
      width={layout.width}
      height={layout.height}
      initial={false}
      animate={{ opacity: mode === 'large' ? 0 : 1 }}
      transition={{ duration: 0, delay: mode === 'large' ? HIDE_IN_LARGE_DELAY : 0 }}
      style={{
        position: 'absolute',
        top: -layout.pad,
        right: -(SPLIT_GAP + bubble + layout.pad),
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <filter id={filterId} x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur ref={blurRef} in="SourceGraphic" stdDeviation={initialBlur} result="blur" />
          <feColorMatrix in="blur" mode="matrix" values={GOO_MATRIX} result="goo" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`} fill="#000">
        <circle cx={layout.circle.cx} cy={layout.circle.cy} r={layout.circle.r} />
        <motion.g initial={false} animate={{ x: isSplit ? layout.travel : 0 }} transition={timing.bubble}>
          <rect x={layout.rect.x} y={layout.rect.y} width={layout.rect.width} height={layout.rect.height} rx={layout.rect.rx} />
        </motion.g>
      </g>
    </motion.svg>
  );
}
