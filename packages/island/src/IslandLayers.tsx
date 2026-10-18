'use client';

import type { CSSProperties, ReactNode } from 'react';
import { motion, useIsPresent, type TargetAndTransition } from 'motion/react';
import { CONTENT_EXIT_DURATION, type IslandTiming } from './geometry';
import type { IslandSize } from './types';

/**
 * The content layers inside the capsule. Each one arrives soft and small (blur 4-5 px, scale .9
 * or scaleX .5, transparent) and comes into focus ~100 ms after the shape starts moving; each one
 * leaves in 150 ms. Under reduced motion only the opacity changes.
 */

type Look = 'slot' | 'body' | 'bubble';

const SHOWN: TargetAndTransition = { opacity: 1, scale: 1, scaleX: 1, x: 0, filter: 'blur(0px)' };

function hiddenLook(look: Look, reduced: boolean, travel: number): TargetAndTransition {
  if (reduced) return { opacity: 0 };
  if (look === 'body') return { opacity: 0, scale: 0.9, filter: 'blur(5px)' };
  if (look === 'bubble') return { opacity: 0, x: -travel, scaleX: 0.5, filter: 'blur(4px)' };
  return { opacity: 0, scaleX: 0.5, filter: 'blur(4px)' };
}

interface FadeProps {
  readonly look: Look;
  readonly timing: IslandTiming;
  readonly reduced: boolean;
  readonly travel?: number;
  readonly style?: CSSProperties;
  readonly className?: string;
  readonly children: ReactNode;
}

function Fade({ look, timing, reduced, travel = 0, style, className, children }: FadeProps) {
  const hidden = hiddenLook(look, reduced, travel);
  const shown = reduced ? { opacity: 1 } : SHOWN;
  return (
    <motion.div
      className={className}
      initial={hidden}
      animate={shown}
      exit={{ ...hidden, transition: { duration: CONTENT_EXIT_DURATION, ease: 'linear' } }}
      transition={{ duration: timing.content.duration, delay: timing.content.delay, ease: 'linear' }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

const slotRow: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const slotCell: CSSProperties = { display: 'flex', alignItems: 'center', minWidth: 0 };

interface SlotLayerProps {
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly height: number;
  readonly timing: IslandTiming;
  readonly reduced: boolean;
}

/** Leading + trailing, riding the capsule's edges as it changes width. Decorative to assistive tech. */
export function SlotLayer({ leading, trailing, height, timing, reduced }: SlotLayerProps) {
  const isPresent = useIsPresent();
  const inset = Math.round(height * 0.28);
  return (
    <div className="rt-island__slots" aria-hidden="true" inert={!isPresent} style={{ ...slotRow, paddingInline: inset, gap: inset }}>
      {leading !== undefined && (
        <Fade look="slot" timing={timing} reduced={reduced} className="rt-island__leading" style={slotCell}>
          {leading}
        </Fade>
      )}
      {trailing !== undefined && (
        <Fade look="slot" timing={timing} reduced={reduced} className="rt-island__trailing" style={{ ...slotCell, marginLeft: 'auto' }}>
          {trailing}
        </Fade>
      )}
    </div>
  );
}

interface BodyLayerProps {
  readonly size: IslandSize;
  readonly timing: IslandTiming;
  readonly reduced: boolean;
  readonly children: ReactNode;
}

/** The large card's content, laid out at its final size so it never reflows while the capsule grows. */
export function BodyLayer({ size, timing, reduced, children }: BodyLayerProps) {
  const isPresent = useIsPresent();
  return (
    <div
      className="rt-island__body"
      inert={!isPresent}
      style={{ position: 'absolute', top: 0, left: '50%', width: size.width, height: size.height, marginLeft: -size.width / 2 }}
    >
      <Fade look="body" timing={timing} reduced={reduced} style={{ width: '100%', height: '100%' }}>
        {children}
      </Fade>
    </div>
  );
}

interface BubbleLayerProps {
  readonly travel: number;
  readonly timing: IslandTiming;
  readonly reduced: boolean;
  readonly children: ReactNode;
}

/** Content of the detached bubble; slides out of the pill as it sharpens. */
export function BubbleLayer({ travel, timing, reduced, children }: BubbleLayerProps) {
  const isPresent = useIsPresent();
  return (
    <div className="rt-island__bubble" aria-hidden="true" inert={!isPresent} style={{ position: 'absolute', inset: 0 }}>
      <Fade
        look="bubble"
        travel={travel}
        timing={timing}
        reduced={reduced}
        style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}
      >
        {children}
      </Fade>
    </div>
  );
}
