/**
 * Level emission helpers: a rate limiter for `engine:level` (≤ 30 Hz) and the synthetic waveform
 * loop that animates the island while TTS is speaking (the engine can't meter its own speech).
 */
import { SILENT_LEVEL, syntheticSpeechLevel } from './dsp/level';
import { LEVEL } from './dsp/tuning';
import type { Reporter } from './report';

export class LevelThrottle {
  private readonly minIntervalMs: number;
  private last = -Infinity;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  /** True (and records the time) when enough time has passed since the last emission. */
  shouldEmit(nowMs: number): boolean {
    if (nowMs - this.last < this.minIntervalMs) return false;
    this.last = nowMs;
    return true;
  }
}

/** Sends a speech-like synthetic envelope at the level rate while running. */
export class SyntheticLevelLoop {
  private readonly report: Reporter;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  constructor(report: Reporter, now: () => number = Date.now) {
    this.report = report;
    this.now = now;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.startedAt = this.now();
    this.timer = setInterval(() => this.report.level(syntheticSpeechLevel(this.now() - this.startedAt)), Math.ceil(1000 / LEVEL.maxRateHz));
  }

  /** Stops and, if it was running, settles the waveform to silence. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.report.level(SILENT_LEVEL);
  }
}
