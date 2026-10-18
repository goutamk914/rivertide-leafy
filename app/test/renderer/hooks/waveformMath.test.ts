import { describe, expect, it } from 'vitest';
import {
  barHeights,
  bellWeight,
  INITIAL_WAVEFORM,
  isQuiet,
  QUIET_LEVEL,
  stepWaveform,
  waveformAlpha,
  type WaveformState,
} from '../../../src/renderer/lib/hooks/waveformMath';

const shape = { bars: 9, minHeight: 3, maxHeight: 24, ripple: true };

function run(levels: readonly number[], from: WaveformState = INITIAL_WAVEFORM): WaveformState {
  return levels.reduce(stepWaveform, from);
}

describe('stepWaveform', () => {
  it('smooths the level toward the input and counts frames', () => {
    const state = stepWaveform(INITIAL_WAVEFORM, 1);

    expect(state.smoothed).toBeCloseTo(0.25);
    expect(state.envelope).toBeCloseTo(0.25);
    expect(state.frame).toBe(1);
  });

  it('holds loud moments with a slowly decaying envelope', () => {
    const loud = run([1, 1, 1, 1, 1, 1, 1, 1]);

    const after = stepWaveform(loud, 0);

    expect(after.envelope).toBeCloseTo(loud.envelope * 0.9);
    expect(after.smoothed).toBeLessThan(after.envelope);
  });

  it('clamps out-of-range and non-finite levels', () => {
    expect(stepWaveform(INITIAL_WAVEFORM, 7).smoothed).toBeCloseTo(0.25);
    expect(stepWaveform(INITIAL_WAVEFORM, Number.NaN).smoothed).toBe(0);
    expect(stepWaveform(INITIAL_WAVEFORM, -1).smoothed).toBe(0);
  });
});

describe('barHeights', () => {
  it('rests every bar as a dot while quiet', () => {
    const quiet = run([0.02, 0.03, 0.01]);

    expect(isQuiet(quiet)).toBe(true);
    expect(barHeights(quiet, shape)).toEqual(Array(9).fill(3));
  });

  it('makes the centre bar the tallest and stays symmetric without ripple', () => {
    const loud = run(Array(30).fill(0.8));

    const heights = barHeights(loud, { ...shape, ripple: false });

    expect(heights[4]).toBe(Math.max(...heights));
    expect(heights[0]).toBeCloseTo(heights[8]);
    expect(heights[2]).toBeCloseTo(heights[6]);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...heights)).toBeLessThanOrEqual(24);
  });

  it('never exceeds the bounds at full level with ripple', () => {
    const full = run(Array(60).fill(1));

    const heights = barHeights(full, shape);

    heights.forEach((h) => {
      expect(h).toBeGreaterThanOrEqual(3);
      expect(h).toBeLessThanOrEqual(24);
    });
  });

  it('lifts quiet speech perceptually (sqrt) so it is visible', () => {
    const soft = run(Array(40).fill(QUIET_LEVEL * 2));

    const centre = barHeights(soft, { ...shape, ripple: false })[4];

    expect(centre).toBeGreaterThan(3 + 21 * soft.envelope);
  });
});

describe('bellWeight', () => {
  it('is 1 at the centre and falls off toward the edges', () => {
    expect(bellWeight(4, 9)).toBe(1);
    expect(bellWeight(0, 9)).toBeCloseTo(Math.exp(-2));
    expect(bellWeight(0, 1)).toBe(1);
  });
});

describe('waveformAlpha', () => {
  it('dims resting dots and brightens with speech', () => {
    expect(waveformAlpha(INITIAL_WAVEFORM)).toBeCloseTo(0.42);
    expect(waveformAlpha(run(Array(40).fill(1)))).toBeCloseTo(1);
  });
});
