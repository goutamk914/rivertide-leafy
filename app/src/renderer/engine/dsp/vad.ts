/**
 * Voice activity detection on 16 kHz mono audio: 20 ms frames, energy (dBFS) + zero-crossing
 * rate against an adaptive noise floor (running minimum that may only rise slowly). Tracks speech
 * segments and pauses for speech dynamics, and decides hands-free endpointing.
 */
import type { SpeechStats } from '@shared/types';
import { VAD } from './tuning';
import { appendBounded } from './history';

export type VadTuning = typeof VAD;
export type VadStopReason = 'endpoint' | 'no-speech' | 'max-duration';

export interface EndpointingConfig {
  readonly enabled: boolean;
  readonly endSilenceMs: number;
  readonly noSpeechTimeoutMs: number;
}

/** Half-open frame range [start, end). */
export interface VadSegment {
  readonly start: number;
  readonly end: number;
}

export interface VadSummary {
  readonly stats: SpeechStats;
  /** Merged speech segments in milliseconds. */
  readonly segmentsMs: readonly { readonly startMs: number; readonly endMs: number }[];
  readonly hasSpeech: boolean;
}

export interface FrameFeatures {
  readonly db: number;
  readonly power: number;
  readonly zcr: number;
}

interface Run {
  readonly start: number;
  readonly lastActive: number;
  readonly activeFrames: number;
  readonly power: number;
}

export function powerToDb(power: number, floorDb: number = VAD.silenceDb): number {
  return power > 0 ? Math.max(floorDb, 10 * Math.log10(power)) : floorDb;
}

/** Energy (mean square, dBFS) and zero-crossing rate of one frame (DC removed). */
export function frameFeatures(frame: Float32Array): FrameFeatures {
  const n = frame.length;
  if (n === 0) return { db: VAD.silenceDb, power: 0, zcr: 0 };
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += frame[i];
  mean /= n;
  let power = 0;
  let crossings = 0;
  let prev = frame[0] - mean;
  for (let i = 0; i < n; i += 1) {
    const s = frame[i] - mean;
    power += s * s;
    if (i > 0 && (s >= 0) !== (prev >= 0)) crossings += 1;
    prev = s;
  }
  power /= n;
  return { db: powerToDb(power), power, zcr: n > 1 ? crossings / (n - 1) : 0 };
}

/** Joins segments separated by less than `minGap` frames. */
export function mergeSegments(segments: readonly VadSegment[], minGap: number): VadSegment[] {
  return segments.reduce<VadSegment[]>((acc, seg) => {
    const last = acc[acc.length - 1];
    if (last && seg.start - last.end < minGap) return [...acc.slice(0, -1), { start: last.start, end: seg.end }];
    return [...acc, seg];
  }, []);
}

export class Vad {
  readonly sampleRate: number;
  private readonly tuning: VadTuning;
  private readonly frameSize: number;
  private readonly frameMs: number;
  private pending: Float32Array = new Float32Array(0);
  private frames = 0;
  private samples = 0;
  private floor: number | null = null;
  private recent: number[] = [];
  private run: Run | null = null;
  private segments: VadSegment[] = [];
  private speechPower = 0;
  private speechFrames = 0;

  constructor(sampleRate: number, tuning: VadTuning = VAD) {
    this.sampleRate = sampleRate;
    this.tuning = tuning;
    this.frameSize = Math.round((sampleRate * tuning.frameMs) / 1000);
    this.frameMs = tuning.frameMs;
  }

  get elapsedMs(): number {
    return (this.samples / this.sampleRate) * 1000;
  }

  get noiseFloorDb(): number {
    return this.floor ?? this.tuning.initialFloorCeilingDb;
  }

  /** True while inside a speech run (including hangover). */
  get inSpeech(): boolean {
    return this.run !== null;
  }

  push(input: Float32Array): void {
    this.samples += input.length;
    const data = new Float32Array(this.pending.length + input.length);
    data.set(this.pending);
    data.set(input, this.pending.length);
    let offset = 0;
    while (offset + this.frameSize <= data.length) {
      this.processFrame(data.subarray(offset, offset + this.frameSize));
      offset += this.frameSize;
    }
    this.pending = data.slice(offset);
  }

  hasSpeech(): boolean {
    return this.segments.length > 0 || this.isValidRun(this.run);
  }

  /** Whether the capture should stop now, given the endpointing settings. */
  decide(config: EndpointingConfig, maxDurationMs: number): VadStopReason | null {
    const elapsed = this.frames * this.frameMs;
    if (elapsed >= maxDurationMs) return 'max-duration';
    if (!config.enabled) return null;
    if (!this.hasSpeech()) return elapsed >= config.noSpeechTimeoutMs ? 'no-speech' : null;
    const silenceMs = (this.frames - this.lastSpeechEnd()) * this.frameMs;
    return silenceMs >= config.endSilenceMs ? 'endpoint' : null;
  }

  /** Closes any open segment and returns the session statistics. Call once, at the end. */
  finish(): VadSummary {
    if (this.run) this.closeRun();
    const { minPauseMs, longPauseMs, silenceDb } = this.tuning;
    const merged = mergeSegments(this.segments, Math.ceil(minPauseMs / this.frameMs));
    const gaps = merged.slice(1).map((seg, i) => (seg.start - merged[i].end) * this.frameMs);
    const speechMs = merged.reduce((sum, seg) => sum + (seg.end - seg.start) * this.frameMs, 0);
    const stats: SpeechStats = {
      durationMs: Math.round(this.elapsedMs),
      speechMs,
      segments: merged.length,
      pauseCount: gaps.length,
      longPauseCount: gaps.filter((g) => g > longPauseMs).length,
      meanPauseMs: gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0,
      maxPauseMs: gaps.length > 0 ? Math.max(...gaps) : 0,
      speechLevelDb: this.speechFrames > 0 ? round1(powerToDb(this.speechPower / this.speechFrames)) : silenceDb,
    };
    return {
      stats,
      hasSpeech: merged.length > 0,
      segmentsMs: merged.map((seg) => ({ startMs: seg.start * this.frameMs, endMs: seg.end * this.frameMs })),
    };
  }

  private processFrame(frame: Float32Array): void {
    const features = frameFeatures(frame);
    const floor = this.updateFloor(features.db);
    const index = this.frames;
    this.frames += 1;
    if (this.isActive(features, floor)) {
      const run = this.run;
      this.run = run
        ? { ...run, lastActive: index, activeFrames: run.activeFrames + 1, power: run.power + features.power }
        : { start: index, lastActive: index, activeFrames: 1, power: features.power };
      return;
    }
    const hangoverFrames = Math.round(this.tuning.hangoverMs / this.frameMs);
    if (this.run && index - this.run.lastActive > hangoverFrames) this.closeRun();
  }

  private isActive(f: FrameFeatures, floor: number): boolean {
    const t = this.tuning;
    if (f.db >= Math.max(floor + t.speechMarginDb, t.absoluteMinSpeechDb)) return true;
    // Unvoiced continuation: quiet, noisy sounds inside an ongoing segment ("…this", "…stuff").
    return this.run !== null
      && f.zcr >= t.unvoicedZcrMin
      && f.db >= Math.max(floor + t.unvoicedMarginDb, t.unvoicedAbsoluteMinDb);
  }

  /** Running minimum over `floorWindowMs`, falling instantly and rising at most `floorRiseDbPerSecond`. */
  private updateFloor(db: number): number {
    const t = this.tuning;
    const windowFrames = Math.max(1, Math.round(t.floorWindowMs / this.frameMs));
    this.recent = appendBounded(this.recent, db, windowFrames);
    if (this.floor === null) {
      this.floor = Math.max(t.floorMinDb, Math.min(db, t.initialFloorCeilingDb));
      return this.floor;
    }
    const windowMin = Math.min(...this.recent);
    const riseLimit = this.floor + (t.floorRiseDbPerSecond * this.frameMs) / 1000;
    this.floor = Math.max(t.floorMinDb, Math.min(windowMin, riseLimit));
    return this.floor;
  }

  private isValidRun(run: Run | null): run is Run {
    return run !== null && run.activeFrames * this.frameMs >= this.tuning.minSpeechMs;
  }

  private closeRun(): void {
    const run = this.run;
    this.run = null;
    if (!this.isValidRun(run)) return;
    this.segments = [...this.segments, { start: run.start, end: run.lastActive + 1 }];
    this.speechPower += run.power;
    this.speechFrames += run.activeFrames;
  }

  private lastSpeechEnd(): number {
    if (this.isValidRun(this.run)) return this.run.lastActive + 1;
    const last = this.segments[this.segments.length - 1];
    return last ? last.end : 0;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
