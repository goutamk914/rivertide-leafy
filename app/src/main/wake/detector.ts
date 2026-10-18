/**
 * The wake-word worker's core: every 80 ms frame goes through the feature chain and the stage-1
 * gate; a candidate is checked against the last 1.5 s of audio (stage 2) and reported as
 * `detected` or `rejected`. Frames are processed strictly in order. Audio lives only in the
 * in-memory ring below and is overwritten continuously.
 */
import { gateConfig, INITIAL_GATE, stepGate, type GateState, type WakeSensitivity } from './gate';
import type { WorkerEvent } from './protocol';
import { VERIFY_MARGINS, type Verdict } from './verify';

export const SAMPLE_RATE = 16_000;
/** The second stage transcribes this much audio, ending at the candidate frame. */
export const RING_SAMPLES = Math.round(1.5 * SAMPLE_RATE);
const PCM_SCALE = 32768;

/** Fixed-size PCM16 history; `latest` returns floats in [-1, 1], oldest first. */
export class AudioRing {
  private readonly buffer: Int16Array;
  private written = 0;

  constructor(capacity: number) {
    this.buffer = new Int16Array(capacity);
  }

  get size(): number {
    return Math.min(this.written, this.buffer.length);
  }

  push(samples: Int16Array): void {
    for (const sample of samples) {
      this.buffer[this.written % this.buffer.length] = sample;
      this.written += 1;
    }
  }

  latest(count: number): Float32Array {
    const n = Math.min(count, this.size);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      out[i] = (this.buffer[(this.written - n + i) % this.buffer.length] ?? 0) / PCM_SCALE;
    }
    return out;
  }

  clear(): void {
    this.buffer.fill(0);
    this.written = 0;
  }
}

export interface DetectorDeps {
  readonly features: { push(frame: Int16Array): Promise<number | null>; reset(): void };
  readonly verify: (audio: Float32Array, margin: number) => Promise<Verdict>;
  readonly emit: (event: WorkerEvent) => void;
}

const clampMargin = (margin: number): number => Math.max(-1000, Math.min(1000, Number.isFinite(margin) ? margin : -1000));

export class WakeDetector {
  private readonly deps: DetectorDeps;
  private readonly ring = new AudioRing(RING_SAMPLES);
  private gate: GateState = INITIAL_GATE;
  private sensitivity: WakeSensitivity;

  constructor(deps: DetectorDeps, sensitivity: WakeSensitivity) {
    this.deps = deps;
    this.sensitivity = sensitivity;
  }

  setSensitivity(sensitivity: WakeSensitivity): void {
    this.sensitivity = sensitivity;
  }

  async push(samples: Int16Array, fresh: boolean): Promise<void> {
    if (fresh) this.reset();
    this.ring.push(samples);
    const score = await this.deps.features.push(samples);
    const step = stepGate(this.gate, score, gateConfig(this.sensitivity));
    this.gate = step.state;
    if (!step.fire || score === null) return;
    const verdict = await this.deps.verify(this.ring.latest(RING_SAMPLES), VERIFY_MARGINS[this.sensitivity]);
    const event = { score: Math.min(1, Math.max(0, score)), margin: clampMargin(verdict.margin) };
    this.deps.emit(verdict.accepted ? { type: 'detected', ...event } : { type: 'rejected', ...event });
  }

  private reset(): void {
    this.deps.features.reset();
    this.ring.clear();
    this.gate = INITIAL_GATE;
  }
}
