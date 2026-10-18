/**
 * Level meter for the island waveform: an envelope follower over RMS on a perceptual dB scale,
 * plus 12 log-spaced FFT bands (80 Hz – 8 kHz). Also a synthetic envelope for TTS playback.
 */
import type { AudioLevel } from '@shared/types';
import { Fft, hannWindow } from './fft';
import { RingBuffer } from './ring-buffer';
import { LEVEL } from './tuning';

export type LevelTuning = typeof LEVEL;

export interface Follower {
  readonly smoothed: number;
  readonly envelope: number;
}

export const SILENT_FOLLOWER: Follower = { smoothed: 0, envelope: 0 };

export function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** Maps dB linearly onto 0..1 between `minDb` and `maxDb`. */
export function dbToUnit(db: number, minDb: number, maxDb: number): number {
  return clamp01((db - minDb) / (maxDb - minDb));
}

export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / samples.length + 1e-20);
}

/** smoothed = s·prev + (1 − s)·cur; the envelope holds peaks and decays by `peakDecay`. */
export function follow(prev: Follower, current: number, tuning: LevelTuning = LEVEL): Follower {
  const smoothed = tuning.smoothing * prev.smoothed + (1 - tuning.smoothing) * current;
  return { smoothed, envelope: clamp01(Math.max(smoothed, prev.envelope * tuning.peakDecay)) };
}

/** `count + 1` log-spaced edges from `minHz` to `maxHz`. */
export function bandEdges(count: number, minHz: number, maxHz: number): number[] {
  const ratio = maxHz / minHz;
  return Array.from({ length: count + 1 }, (_, i) => minHz * ratio ** (i / count));
}

export class LevelMeter {
  private readonly sampleRate: number;
  private readonly tuning: LevelTuning;
  private readonly ring: RingBuffer;
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly spectrum: Float64Array;
  private readonly frame: Float32Array;
  private readonly bins: readonly (readonly [number, number, number])[];
  private level: Follower = SILENT_FOLLOWER;
  private bands: readonly Follower[];

  constructor(sampleRate: number, tuning: LevelTuning = LEVEL) {
    this.sampleRate = sampleRate;
    this.tuning = tuning;
    this.ring = new RingBuffer(tuning.fftSize);
    this.fft = new Fft(tuning.fftSize);
    this.window = hannWindow(tuning.fftSize);
    this.spectrum = new Float64Array(tuning.fftSize / 2 + 1);
    this.frame = new Float32Array(tuning.fftSize);
    this.bins = this.bandBins();
    this.bands = this.bins.map(() => SILENT_FOLLOWER);
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.ring.write(samples);
    const unit = dbToUnit(rmsDb(samples), this.tuning.minDb, this.tuning.maxDb);
    this.level = follow(this.level, unit, this.tuning);
  }

  /** Current level and bands; call at the emission rate (bands are smoothed per read). */
  read(): AudioLevel {
    const { fftSize, bandMinDb, bandMaxDb } = this.tuning;
    this.fft.powerSpectrum(this.ring.latest(fftSize, this.frame), this.window, this.spectrum);
    const fullScale = (fftSize * fftSize) / 16; // |X|² of a full-scale sine under a Hann window
    this.bands = this.bins.map(([lo, hi, tiltDb], i) => {
      let sum = 0;
      for (let k = lo; k <= hi; k += 1) sum += this.spectrum[k];
      const db = 10 * Math.log10(sum / (hi - lo + 1) / fullScale + 1e-20) + tiltDb;
      return follow(this.bands[i], dbToUnit(db, bandMinDb, bandMaxDb), this.tuning);
    });
    return { level: this.level.envelope, bands: this.bands.map((b) => b.envelope) };
  }

  reset(): void {
    this.level = SILENT_FOLLOWER;
    this.bands = this.bins.map(() => SILENT_FOLLOWER);
  }

  private bandBins(): [number, number, number][] {
    const { bandCount, bandMinHz, bandMaxHz, fftSize, bandTiltDbPerOctave, bandTiltPivotHz } = this.tuning;
    const nyquistBin = fftSize / 2;
    const edges = bandEdges(bandCount, bandMinHz, Math.min(bandMaxHz, this.sampleRate / 2));
    return edges.slice(0, -1).map((lo, i) => {
      const hi = edges[i + 1];
      const loBin = Math.min(nyquistBin, Math.max(1, Math.ceil((lo * fftSize) / this.sampleRate)));
      const hiBin = Math.min(nyquistBin, Math.max(loBin, Math.floor((hi * fftSize) / this.sampleRate)));
      const tilt = bandTiltDbPerOctave * Math.log2(Math.sqrt(lo * hi) / bandTiltPivotHz);
      return [loBin, hiBin, tilt];
    });
  }
}

/** A speech-like envelope (≈4 syllables/s) for animating the waveform while TTS talks. */
export function syntheticSpeechLevel(timeMs: number, bandCount: number = LEVEL.bandCount): AudioLevel {
  const t = timeMs / 1000;
  const syllable = Math.max(0, Math.sin(2 * Math.PI * 4.2 * t));
  const phrase = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.35 * t);
  const level = clamp01(0.15 + 0.5 * Math.sqrt(syllable) * phrase);
  const bands = Array.from({ length: bandCount }, (_, i) => {
    const x = bandCount > 1 ? i / (bandCount - 1) : 0;
    const formant = Math.exp(-((x - 0.35) ** 2) / 0.08);
    const shimmer = 0.85 + 0.15 * Math.sin(2 * Math.PI * (1.3 + i * 0.37) * t + i);
    return clamp01(level * formant * shimmer);
  });
  return { level, bands };
}

export const SILENT_LEVEL: AudioLevel = { level: 0, bands: Array.from({ length: LEVEL.bandCount }, () => 0) };
