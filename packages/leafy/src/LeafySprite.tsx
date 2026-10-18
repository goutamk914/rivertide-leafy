'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { frameAt, settledMood, type LeafyMood } from './animations';
import { getPose, LEAFY, type PoseName } from './poses';
import { drawFrame, frameFromPose } from './render';

export interface LeafySpriteProps {
  /** Animated mood. Ignored when `pose` is set. */
  readonly mood?: LeafyMood;
  /** Freeze Leafy on one pose. */
  readonly pose?: PoseName;
  /** CSS pixels per sprite pixel. 4 renders Leafy at 96x112. */
  readonly scale?: number;
  /** Accessible description. Omit (or pass `decorative`) when the sprite is purely ornamental. */
  readonly label?: string;
  readonly decorative?: boolean;
  /** Called when a one-shot mood finishes, with the mood Leafy settles into. */
  readonly onSettle?: (next: LeafyMood) => void;
  /** Force the static rendering even if the OS allows motion. */
  readonly reducedMotion?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Canvas-rendered Leafy. Draws straight from the pose pack, so it stays pixel-crisp at any scale
 * and on any display density. One requestAnimationFrame loop per sprite; it only repaints when
 * the visible frame actually changes.
 */
export function LeafySprite({
  mood = 'idle',
  pose,
  scale = 4,
  label,
  decorative,
  onSettle,
  reducedMotion,
  className,
  style,
}: LeafySpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSettleRef = useRef(onSettle);

  useEffect(() => {
    onSettleRef.current = onSettle;
  }, [onSettle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const reduce = reducedMotion ?? prefersReducedMotion();
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const start = performance.now();
    let lastKey = '';
    let settled = false;
    let raf = 0;

    const paint = (now: number) => {
      const state = pose
        ? { pose, offsetY: 0, blink: false, done: false }
        : frameAt(mood, now - start, { reducedMotion: reduce });
      const key = `${state.pose}|${state.offsetY}|${state.blink}`;
      if (key !== lastKey) {
        lastKey = key;
        drawFrame(canvas, frameFromPose(getPose(state.pose), { blink: state.blink, offsetY: state.offsetY }), { scale, dpr });
      }
      if (state.done && !settled) {
        settled = true;
        onSettleRef.current?.(settledMood(mood));
      }
      if (!settled && !pose) raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [mood, pose, scale, reducedMotion]);

  const width = LEAFY.width * scale;
  const height = LEAFY.height * scale;
  const accessibility = decorative || !label
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': label };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ width, height, imageRendering: 'pixelated', ...style }}
      {...accessibility}
    />
  );
}
