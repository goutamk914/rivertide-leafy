import { useEffect, useRef, type RefObject } from 'react';
import type { AudioLevel } from '@shared/types';
import { barHeights, INITIAL_WAVEFORM, stepWaveform, waveformAlpha, type WaveformState } from './waveformMath';

export interface WaveformProps {
  /** From `useAudioLevel()`; read every animation frame. */
  readonly levelRef: RefObject<AudioLevel>;
  readonly bars?: number;
  readonly barWidth?: number;
  readonly gap?: number;
  /** Canvas height in px; the tallest bar leaves a little air. */
  readonly height?: number;
  readonly reducedMotion?: boolean;
  readonly className?: string;
}

const MIN_BAR = 3;

/**
 * A live level meter drawn on a canvas (no DOM layout per frame). Colour follows CSS `color`,
 * so it is white in the island and ink-coloured elsewhere. Decorative: say "Listening" in text.
 */
export function Waveform({ levelRef, bars = 9, barWidth = 3, gap = 2.5, height = 26, reducedMotion = false, className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = Math.ceil(bars * barWidth + (bars - 1) * gap);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const color = getComputedStyle(canvas).color;
    const shape = { bars, minHeight: MIN_BAR, maxHeight: height - 2, ripple: !reducedMotion };
    let state: WaveformState = INITIAL_WAVEFORM;
    let lastKey = '';
    let raf = 0;

    const draw = () => {
      state = stepWaveform(state, levelRef.current?.level ?? 0);
      const heights = barHeights(state, shape);
      const alpha = waveformAlpha(state);
      const key = `${heights.map((h) => h.toFixed(1)).join(',')}|${alpha.toFixed(2)}`;
      if (key !== lastKey) {
        lastKey = key;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        heights.forEach((h, i) => {
          ctx.beginPath();
          ctx.roundRect(i * (barWidth + gap), (height - h) / 2, barWidth, h, barWidth / 2);
          ctx.fill();
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, bars, barWidth, gap, height, width, reducedMotion]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" style={{ width, height, display: 'block' }} />;
}
