'use client';

import type { CSSProperties, ReactNode } from 'react';
import { motion, useTransform, type MotionValue } from 'motion/react';
import { LeafySprite, type LeafyMood } from '@rivertide/leafy';

/** Small pieces drawn inside the black capsule. All decorative: scenes speak through `label`. */

export function IslandLeafy({ mood = 'idle' }: { readonly mood?: LeafyMood }) {
  return <LeafySprite mood={mood} scale={1} decorative className="rt-island-leafy" />;
}

export function IslandText({ children, tone = 'ink' }: { readonly children: ReactNode; readonly tone?: 'ink' | 'muted' }) {
  return <span className={tone === 'muted' ? 'rt-island-text rt-island-text--muted' : 'rt-island-text'}>{children}</span>;
}

/** Bar heights for a waveform that reads as speech, not a sine wave. */
const BARS = [0.45, 0.8, 1, 0.62, 0.9, 0.5, 0.74];

export function Waveform({ tone = 'ink' }: { readonly tone?: 'ink' | 'ask' | 'accent' }) {
  return (
    <span className={`rt-wave rt-wave--${tone}`} aria-hidden="true">
      {BARS.map((height, index) => (
        <i key={index} style={{ '--h': height, '--wd': `${index * 110}ms` } as CSSProperties} />
      ))}
    </span>
  );
}

export function Dots() {
  return (
    <span className="rt-dots" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <i key={index} style={{ '--i': index } as CSSProperties} />
      ))}
    </span>
  );
}

const RING_SIZE = 18;
const RING_STROKE = 2.25;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** How far down the page you are: a thin ring plus the percentage, driven by a motion value. */
export function ProgressRing({ progress }: { readonly progress: MotionValue<number> }) {
  const offset = useTransform(progress, (value) => RING_LENGTH * (1 - Math.min(1, Math.max(0, value))));
  const percent = useTransform(progress, (value) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`);
  return (
    <span className="rt-island-progress">
      <svg className="rt-island-ring" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="var(--island-row-hover)" strokeWidth={RING_STROKE} />
        <motion.circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <motion.span className="rt-island-percent tabular">{percent}</motion.span>
    </span>
  );
}
