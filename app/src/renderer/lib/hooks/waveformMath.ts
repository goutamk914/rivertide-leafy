/**
 * Pure waveform maths for the listening indicators (island, Leafy's mic, palette mic).
 * Ported from the old overlay: the level is smoothed, held by a decaying envelope (so bars don't
 * flicker between syllables), shaped by a bell curve (tall centre, short edges) and modulated by
 * a travelling sine. Below a quiet threshold every bar rests as a dot.
 */

export interface WaveformState {
  readonly smoothed: number;
  readonly envelope: number;
  readonly frame: number;
}

export interface WaveformShape {
  readonly bars: number;
  /** Resting dot height, px. */
  readonly minHeight: number;
  /** Tallest bar at full level, px. */
  readonly maxHeight: number;
  /** Travelling sine on/off (off under reduced motion: bars still follow the voice, but don't ripple). */
  readonly ripple: boolean;
}

export const INITIAL_WAVEFORM: WaveformState = Object.freeze({ smoothed: 0, envelope: 0, frame: 0 });

const SMOOTHING = 0.75;
const ENVELOPE_DECAY = 0.9;
export const QUIET_LEVEL = 0.1;
const WAVE_SPEED = 0.09;
const WAVE_PHASE = 0.65;
/** exp(-BELL_FALLOFF * x²) with x = distance from centre / half-width; 2 matches the original 9-bar curve. */
const BELL_FALLOFF = 2;

/** Advances one animation frame with a fresh 0..1 level reading. */
export function stepWaveform(state: WaveformState, level: number): WaveformState {
  const input = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const smoothed = state.smoothed * SMOOTHING + input * (1 - SMOOTHING);
  const envelope = Math.max(smoothed, state.envelope * ENVELOPE_DECAY);
  return { smoothed, envelope, frame: state.frame + 1 };
}

export function isQuiet(state: WaveformState): boolean {
  return state.envelope < QUIET_LEVEL;
}

/** Bell weight for bar `index` of `bars` (1 at the centre). */
export function bellWeight(index: number, bars: number): number {
  const half = (bars - 1) / 2;
  if (half <= 0) return 1;
  const x = (index - half) / half;
  return Math.exp(-BELL_FALLOFF * x * x);
}

/** Bar heights in px for the current state. */
export function barHeights(state: WaveformState, shape: WaveformShape): readonly number[] {
  const { bars, minHeight, maxHeight, ripple } = shape;
  if (isQuiet(state)) return Array.from({ length: bars }, () => minHeight);
  // Perceptual lift: speech often sits at 0.1–0.4, which would barely move linear bars.
  const level = Math.min(1, Math.sqrt(state.envelope));
  const t = state.frame * WAVE_SPEED;
  const range = maxHeight - minHeight;
  return Array.from({ length: bars }, (_, i) => {
    const wave = ripple ? (Math.sin(t + i * WAVE_PHASE) + 1) / 2 : 1;
    const height = minHeight + range * bellWeight(i, bars) * level * (0.5 + 0.5 * wave);
    return Math.max(minHeight, Math.min(maxHeight, height));
  });
}

/** Ink opacity: resting dots are dim, speech brightens the bars. */
export function waveformAlpha(state: WaveformState): number {
  return 0.42 + 0.58 * Math.min(1, state.envelope * 2);
}
