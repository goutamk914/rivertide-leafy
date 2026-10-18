/**
 * The engine's sound cues as plain data: short, gentle sine notes with soft attacks. Peak gain is
 * capped at 0.12 so nothing startles a tired listener.
 */
import type { CueName } from './commands';

export interface CueNote {
  /** Start frequency in Hz. */
  readonly hz: number;
  /** Optional glide target (a rising "question"). */
  readonly toHz?: number;
  readonly atMs: number;
  readonly durationMs: number;
  readonly gain: number;
}

export const MAX_CUE_GAIN = 0.12;
export const CUE_ATTACK_MS = 12;
/** Exponential ramps cannot reach 0; start/end here instead (≈ −80 dB, inaudible, click-free). */
export const CUE_SILENCE_GAIN = 0.0001;

export const CUE_NOTES: Readonly<Record<CueName, readonly CueNote[]>> = {
  // Two rising notes: "I'm listening".
  start: [
    { hz: 660, atMs: 0, durationMs: 70, gain: 0.08 },
    { hz: 880, atMs: 80, durationMs: 70, gain: 0.08 },
  ],
  // The same pair falling: "got it".
  stop: [
    { hz: 880, atMs: 0, durationMs: 70, gain: 0.07 },
    { hz: 660, atMs: 80, durationMs: 70, gain: 0.07 },
  ],
  // Soft major third (C6 → E6).
  success: [
    { hz: 1046.5, atMs: 0, durationMs: 110, gain: 0.06 },
    { hz: 1318.5, atMs: 90, durationMs: 160, gain: 0.06 },
  ],
  // Low two-note, gentle rather than alarming.
  error: [
    { hz: 330, atMs: 0, durationMs: 140, gain: 0.1 },
    { hz: 262, atMs: 150, durationMs: 200, gain: 0.1 },
  ],
  // Quick bright blip: "I heard the claps".
  clap: [{ hz: 1568, atMs: 0, durationMs: 45, gain: 0.05 }],
  // A rising, questioning glide.
  confirm: [
    { hz: 587.3, atMs: 0, durationMs: 90, gain: 0.07 },
    { hz: 659.3, toHz: 784, atMs: 100, durationMs: 180, gain: 0.07 },
  ],
  // Three soft chimes.
  reminder: [
    { hz: 784, atMs: 0, durationMs: 220, gain: 0.06 },
    { hz: 988, atMs: 240, durationMs: 220, gain: 0.06 },
    { hz: 1175, atMs: 480, durationMs: 320, gain: 0.06 },
  ],
};

/** How long a cue lasts, end of the last note included. */
export function cueDurationMs(name: CueName): number {
  return Math.max(...CUE_NOTES[name].map((n) => n.atMs + n.durationMs));
}
