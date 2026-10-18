/**
 * Stage 1 of the "Hey Leafy" detector: turns the classifier's score (one every 80 ms) into at
 * most one candidate per cooldown. A candidate still has to pass the transcription check
 * (verify.ts) before Leafy is summoned. Pure and immutable.
 */
export type WakeSensitivity = 'low' | 'medium' | 'high';

/** Classifier thresholds per sensitivity, chosen from scripts/wake-word/evaluate.py results. */
export const WAKE_THRESHOLDS: Readonly<Record<WakeSensitivity, number>> = { low: 0.8, medium: 0.6, high: 0.4 };
/** Consecutive frames at or above the threshold before a candidate fires. */
export const PATIENCE_FRAMES = 1;
/** Frames (80 ms each) after a candidate during which nothing else fires: 2 s. */
export const COOLDOWN_FRAMES = 25;

export interface GateConfig {
  readonly threshold: number;
  readonly patience: number;
  readonly cooldown: number;
}

export interface GateState {
  /** Frames seen since the last reset. */
  readonly frame: number;
  /** Consecutive frames at or above the threshold. */
  readonly run: number;
  /** Last frame of the current cooldown (-1 = none). */
  readonly blockedUntil: number;
}

export const INITIAL_GATE: GateState = { frame: 0, run: 0, blockedUntil: -1 };

export function gateConfig(sensitivity: WakeSensitivity): GateConfig {
  return { threshold: WAKE_THRESHOLDS[sensitivity], patience: PATIENCE_FRAMES, cooldown: COOLDOWN_FRAMES };
}

/**
 * Advances the gate by one frame. `score` is null while the feature buffers are still filling
 * (after a start or a gap in the audio); such frames never fire and break any run.
 */
export function stepGate(state: GateState, score: number | null, config: GateConfig): { readonly state: GateState; readonly fire: boolean } {
  const frame = state.frame;
  const run = score !== null && Number.isFinite(score) && score >= config.threshold ? state.run + 1 : 0;
  const next = { frame: frame + 1, run, blockedUntil: state.blockedUntil };
  if (frame <= state.blockedUntil || run < config.patience) return { state: next, fire: false };
  return { state: { ...next, run: 0, blockedUntil: frame + config.cooldown }, fire: true };
}
