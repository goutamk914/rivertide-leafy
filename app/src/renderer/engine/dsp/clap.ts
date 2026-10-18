/**
 * Double-clap detector (ARCHITECTURE.md §3.12). Pure and deterministic: feed it Float32 audio at
 * any rate; it returns detections timed in milliseconds of audio since the first sample.
 *
 * Pipeline per 256-sample hop: features (clap-features.ts) → onset candidate (prominence over the
 * floor, sudden rise, broadband flux, flat spectrum) → peak search → validation (fast decay, high
 * crest factor) → pairing (150–750 ms, similar peaks, quiet in between) → isolation (nothing
 * just before the first clap, nothing just after the second) → fire, then cool down.
 */
import { ClapFeatureExtractor, PercentileTracker, type ClapTuning, type HopFeatures } from './clap-features';
import { appendBounded } from './history';
import { RingBuffer } from './ring-buffer';
import { CLAP, type ClapSensitivity } from './tuning';

export type { ClapSensitivity };

export interface ClapDetection {
  /** When the detection fired (after the isolation window). */
  readonly atMs: number;
  readonly firstMs: number;
  readonly secondMs: number;
}

interface Hit {
  readonly onsetHop: number;
  readonly onsetMs: number;
  readonly peakHop: number;
  readonly peakMs: number;
  readonly peakDb: number;
}

interface PendingEvent extends Hit {
  readonly minAfterPeakDb: number;
}

const RAW_HISTORY_MS = 1000;
const ENERGY_HISTORY_MS = 1200;
const ONSET_MEMORY_MS = 1000;

export class ClapDetector {
  readonly sampleRate: number;
  private readonly tuning: ClapTuning;
  private readonly features: ClapFeatureExtractor;
  private readonly floor: PercentileTracker;
  private readonly raw: RingBuffer;
  private readonly energies: RingBuffer;
  private readonly frame: Float32Array;
  private readonly hopDurationMs: number;
  private readonly warmupHops: number;
  private sensitivity: ClapSensitivity;
  private nextHop = 0;
  private recentEnergies: readonly number[] = [];
  private event: PendingEvent | null = null;
  private first: Hit | null = null;
  private second: Hit | null = null;
  private onsets: readonly number[] = [];
  private refractoryUntilMs = -Infinity;
  private cooldownUntilMs = -Infinity;

  constructor(options: { sampleRate: number; sensitivity: ClapSensitivity; tuning?: ClapTuning }) {
    const tuning = options.tuning ?? CLAP;
    if (!(options.sampleRate > 0)) throw new Error('Clap detector needs a positive sample rate.');
    this.sampleRate = options.sampleRate;
    this.tuning = tuning;
    this.sensitivity = options.sensitivity;
    this.features = new ClapFeatureExtractor(options.sampleRate, tuning);
    this.hopDurationMs = (tuning.hop / options.sampleRate) * 1000;
    this.floor = new PercentileTracker(Math.ceil(tuning.floorWindowMs / this.hopDurationMs), tuning.floorPercentile);
    this.warmupHops = Math.ceil(tuning.floorWarmupMs / this.hopDurationMs);
    this.raw = new RingBuffer(Math.max(tuning.fftSize * 2, Math.ceil((options.sampleRate * RAW_HISTORY_MS) / 1000)));
    this.energies = new RingBuffer(Math.ceil(ENERGY_HISTORY_MS / this.hopDurationMs));
    this.frame = new Float32Array(tuning.fftSize);
  }

  get floorDb(): number {
    return Math.max(this.tuning.floorMinDb, this.floor.value(this.tuning.floorMinDb));
  }

  setSensitivity(sensitivity: ClapSensitivity): void {
    this.sensitivity = sensitivity;
  }

  /**
   * Feeds audio. While `suppressed` (recording, speaking, user typing) the floor keeps learning but
   * nothing is detected, and a clap right after suppression must still be isolated.
   */
  process(samples: Float32Array, suppressed = false): ClapDetection[] {
    const detections: ClapDetection[] = [];
    const { hop, fftSize } = this.tuning;
    for (let offset = 0; offset < samples.length; offset += hop) {
      this.raw.write(samples.subarray(offset, Math.min(samples.length, offset + hop)));
      while (this.nextHop * hop + fftSize <= this.raw.total) {
        const index = this.nextHop;
        this.nextHop += 1;
        const features = this.features.compute(this.raw.read(index * hop, fftSize, this.frame));
        const detection = this.step(features, index, suppressed);
        if (detection) detections.push(detection);
      }
    }
    return detections;
  }

  private hopMs(hop: number): number {
    return ((hop * this.tuning.hop + this.tuning.fftSize / 2) / this.sampleRate) * 1000;
  }

  private step(f: HopFeatures, hop: number, suppressed: boolean): ClapDetection | null {
    const t = this.hopMs(hop);
    const floor = this.floorDb;
    const previous = this.recentEnergies.length > 0 ? Math.min(...this.recentEnergies) : f.energyDb;
    this.recentEnergies = appendBounded(this.recentEnergies, f.energyDb, this.tuning.onsetLookbackHops);
    this.energies.write(Float32Array.of(f.energyDb));

    const gated = suppressed || this.floor.size < this.warmupHops || floor > this.tuning.maxFloorDb;
    if (gated) {
      this.event = null;
      this.first = null;
      this.second = null;
      this.onsets = [t]; // whatever happened while gated counts as activity for isolation
      this.floor.push(f.energyDb);
      return null;
    }
    if (this.event) this.advanceEvent(f.energyDb, hop, t, floor);
    if (this.isCandidate(f, floor, previous) && !this.inPeakSearch(hop)) this.onCandidate(hop, t, f.energyDb);
    if (!this.event) this.floor.push(f.energyDb); // the floor is frozen during events
    return this.maybeFire(t);
  }

  private isCandidate(f: HopFeatures, floor: number, previous: number): boolean {
    const t = this.tuning;
    return f.energyDb - floor >= t.thresholdDb[this.sensitivity]
      && f.energyDb - previous >= t.minRiseDb
      && f.fluxRatio >= t.minFluxRatio
      && f.flatness >= t.minFlatness;
  }

  private inPeakSearch(hop: number): boolean {
    return this.event !== null && hop <= this.event.onsetHop + this.tuning.peakSearchHops;
  }

  private onCandidate(hop: number, t: number, energyDb: number): void {
    this.onsets = [...this.onsets.filter((o) => t - o <= ONSET_MEMORY_MS), t];
    if (this.event || t < this.refractoryUntilMs || t < this.cooldownUntilMs) return;
    this.event = { onsetHop: hop, onsetMs: t, peakHop: hop, peakMs: t, peakDb: energyDb, minAfterPeakDb: Infinity };
  }

  private advanceEvent(energyDb: number, hop: number, t: number, floor: number): void {
    const ev = this.event as PendingEvent;
    if (hop <= ev.onsetHop + this.tuning.peakSearchHops) {
      this.event = energyDb > ev.peakDb
        ? { ...ev, peakHop: hop, peakMs: t, peakDb: energyDb, minAfterPeakDb: Infinity }
        : { ...ev, minAfterPeakDb: Math.min(ev.minAfterPeakDb, energyDb) };
      return;
    }
    const withinDecay = t - ev.peakMs <= this.tuning.decayWindowMs;
    const current = withinDecay ? { ...ev, minAfterPeakDb: Math.min(ev.minAfterPeakDb, energyDb) } : ev;
    const decayed = current.minAfterPeakDb <= current.peakDb - this.tuning.minDecayDb;
    if (decayed && this.crestReady(current)) {
      this.event = null;
      if (this.crestFactor(current) >= this.tuning.minCrest) this.onClap(current, floor);
      return;
    }
    this.event = withinDecay ? current : null; // too slow to decay: not a clap
  }

  private onClap(hit: Hit, floor: number): void {
    this.refractoryUntilMs = hit.peakMs + this.tuning.refractoryMs;
    if (this.first && !this.second && this.pairs(this.first, hit, floor)) {
      this.second = hit;
      return;
    }
    this.second = null;
    this.first = this.isIsolated(hit) ? hit : null;
  }

  private pairs(first: Hit, second: Hit, floor: number): boolean {
    const t = this.tuning;
    const gap = second.peakMs - first.peakMs;
    if (gap < t.pairMinMs || gap > t.pairMaxMs) return false;
    if (Math.abs(second.peakDb - first.peakDb) > t.pairMaxPeakDiffDb) return false;
    if (this.onsets.some((o) => o > first.onsetMs && o < second.onsetMs)) return false;
    return this.minEnergy(first.peakHop + 1, second.onsetHop - 1) <= floor + t.betweenNearFloorDb;
  }

  private isIsolated(hit: Hit): boolean {
    const from = hit.onsetMs - this.tuning.isolationBeforeMs;
    return !this.onsets.some((o) => o >= from && o < hit.onsetMs);
  }

  private maybeFire(t: number): ClapDetection | null {
    const { first, second } = this;
    if (!first || !second || t < second.peakMs + this.tuning.isolationAfterMs) return null;
    this.first = null;
    this.second = null;
    if (this.onsets.some((o) => o > second.onsetMs)) return null; // a third onset: applause, typing, music
    this.cooldownUntilMs = t + this.tuning.cooldownMs;
    return { atMs: t, firstMs: first.peakMs, secondMs: second.peakMs };
  }

  private minEnergy(fromHop: number, toHop: number): number {
    const from = Math.max(fromHop, this.energies.oldest);
    if (toHop < from) return Infinity;
    const values = this.energies.read(from, toHop - from + 1);
    return values.reduce((min, v) => Math.min(min, v), Infinity);
  }

  private crestSpan(): { pre: number; length: number } {
    const ms = (v: number) => Math.round((v * this.sampleRate) / 1000);
    return { pre: ms(this.tuning.crestPreMs), length: ms(this.tuning.crestWindowMs) };
  }

  private crestReady(ev: Hit): boolean {
    const { pre, length } = this.crestSpan();
    return this.raw.total >= ev.peakHop * this.tuning.hop + this.tuning.fftSize + length - pre;
  }

  /** Peak / RMS in a 50 ms window starting just before the loudest sample of the peak frame. */
  private crestFactor(ev: Hit): number {
    const start = ev.peakHop * this.tuning.hop;
    const frame = this.raw.read(start, this.tuning.fftSize);
    let loudest = 0;
    for (let i = 1; i < frame.length; i += 1) if (Math.abs(frame[i]) > Math.abs(frame[loudest])) loudest = i;
    const { pre, length } = this.crestSpan();
    const window = this.raw.read(start + loudest - pre, length);
    const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
    let peak = 0;
    let power = 0;
    for (const v of window) {
      const s = v - mean;
      peak = Math.max(peak, Math.abs(s));
      power += s * s;
    }
    const rms = Math.sqrt(power / window.length);
    return rms > 0 ? peak / rms : 0;
  }
}
