/**
 * Per-hop spectral features for the clap detector (ARCHITECTURE.md §3.12 step 1):
 * band energy E (2–8 kHz, dBFS), flux ratio R (share of 1–10 kHz bins that rose ≥ 8 dB),
 * spectral flatness over 1–10 kHz, and a running-percentile noise floor.
 */
import { Fft, binForHz, hannWindow, windowPowerGain } from './fft';
import { appendBounded } from './history';
import { CLAP } from './tuning';

export type ClapTuning = typeof CLAP;

export interface HopFeatures {
  readonly energyDb: number;
  readonly fluxRatio: number;
  readonly flatness: number;
}

const POWER_EPSILON = 1e-14;
const MIN_ENERGY_DB = -140;

export class ClapFeatureExtractor {
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly spectrum: Float64Array;
  private readonly bandLo: number;
  private readonly bandHi: number;
  private readonly fluxLo: number;
  private readonly fluxHi: number;
  private readonly energyScale: number;
  private readonly binRiseDb: number;
  /** Per-bin dB of the last `lookback` hops (oldest first). */
  private history: readonly Float64Array[] = [];
  private readonly lookback: number;

  constructor(sampleRate: number, tuning: ClapTuning = CLAP) {
    const n = tuning.fftSize;
    this.fft = new Fft(n);
    this.window = hannWindow(n);
    this.spectrum = new Float64Array(n / 2 + 1);
    this.bandLo = binForHz(tuning.bandLowHz, n, sampleRate);
    this.bandHi = Math.max(this.bandLo, binForHz(tuning.bandHighHz, n, sampleRate));
    this.fluxLo = binForHz(tuning.fluxLowHz, n, sampleRate);
    this.fluxHi = Math.max(this.fluxLo, Math.min(n / 2 - 1, binForHz(tuning.fluxHighHz, n, sampleRate)));
    // Parseval: band power (mean square) = 2·Σ|X_k|² / (N²·mean(w²)).
    this.energyScale = 2 / (n * n * windowPowerGain(this.window));
    this.binRiseDb = tuning.binRiseDb;
    this.lookback = Math.max(1, tuning.onsetLookbackHops);
  }

  /** `frame` must hold `fftSize` samples; it is not modified. */
  compute(frame: Float32Array): HopFeatures {
    const p = this.fft.powerSpectrum(frame, this.window, this.spectrum);
    let band = 0;
    for (let k = this.bandLo; k <= this.bandHi; k += 1) band += p[k];
    const energyDb = Math.max(MIN_ENERGY_DB, 10 * Math.log10(band * this.energyScale + 1e-20));

    const count = this.fluxHi - this.fluxLo + 1;
    const binsDb = new Float64Array(count);
    let logSum = 0;
    let linSum = 0;
    for (let i = 0; i < count; i += 1) {
      const power = p[this.fluxLo + i] + POWER_EPSILON;
      binsDb[i] = 10 * Math.log10(power);
      logSum += Math.log(power);
      linSum += power;
    }
    const flatness = Math.exp(logSum / count) / (linSum / count);
    const fluxRatio = this.fluxRatio(binsDb);
    this.history = appendBounded(this.history, binsDb, this.lookback);
    return { energyDb, fluxRatio, flatness };
  }

  /** Share of bins that rose ≥ binRiseDb above their quietest value over the lookback hops. */
  private fluxRatio(binsDb: Float64Array): number {
    if (this.history.length === 0) return 0;
    let rising = 0;
    for (let i = 0; i < binsDb.length; i += 1) {
      let reference = Infinity;
      for (const past of this.history) reference = Math.min(reference, past[i]);
      if (binsDb[i] - reference >= this.binRiseDb) rising += 1;
    }
    return rising / binsDb.length;
  }
}

/** Running percentile over a fixed number of most recent values. */
export class PercentileTracker {
  private readonly values: Float64Array;
  private readonly percentile: number;
  private count = 0;
  private next = 0;
  private cached: number | null = null;

  constructor(capacity: number, percentile: number) {
    this.values = new Float64Array(Math.max(1, capacity));
    this.percentile = Math.min(1, Math.max(0, percentile));
  }

  get size(): number {
    return this.count;
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
    this.cached = null;
  }

  /** The percentile of the stored values, or `fallback` when empty. */
  value(fallback: number): number {
    if (this.count === 0) return fallback;
    if (this.cached === null) {
      const sorted = this.values.slice(0, this.count).sort();
      this.cached = sorted[Math.min(this.count - 1, Math.floor(this.percentile * this.count))];
    }
    return this.cached;
  }
}
