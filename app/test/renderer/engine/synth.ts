/**
 * Deterministic test-signal synthesizers for the engine DSP tests (seeded PRNG, no randomness
 * leaks between tests). All generators return new arrays; nothing is mutated in place.
 */

export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for test noise. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box–Muller). */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const dbToAmp = (db: number): number => 10 ** (db / 20);
export const msToSamples = (ms: number, sampleRate: number): number => Math.round((ms * sampleRate) / 1000);

export function silence(ms: number, sampleRate: number): Float32Array {
  return new Float32Array(msToSamples(ms, sampleRate));
}

/** Sine with the given RMS level (dBFS). */
export function tone(freq: number, ms: number, sampleRate: number, rmsDb = -20): Float32Array {
  const amp = dbToAmp(rmsDb) * Math.SQRT2;
  return Float32Array.from({ length: msToSamples(ms, sampleRate) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sampleRate));
}

/** Gaussian white noise with the given RMS level (dBFS). */
export function whiteNoise(ms: number, sampleRate: number, rmsDb: number, rng: Rng): Float32Array {
  const sigma = dbToAmp(rmsDb);
  return Float32Array.from({ length: msToSamples(ms, sampleRate) }, () => sigma * gaussian(rng));
}

/** One-pole high-pass (returns a new array). */
export function highPass(input: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + 1 / sampleRate);
  const out = new Float32Array(input.length);
  let prevIn = 0;
  let prevOut = 0;
  input.forEach((x, i) => {
    prevOut = alpha * (prevOut + x - prevIn);
    prevIn = x;
    out[i] = prevOut;
  });
  return out;
}

export interface BurstOptions {
  /** RMS of the noise at the envelope peak (dBFS). */
  readonly levelDb?: number;
  readonly attackMs?: number;
  /** Exponential decay time constant of the amplitude. */
  readonly decayMs?: number;
  readonly lengthMs?: number;
  readonly highPassHz?: number;
}

/**
 * Hand clap: broadband noise burst with a ~2 ms attack and an exponential decay that has mostly
 * died away (≈ −35 dB) after ~40 ms (`decayMs` is the amplitude time constant, 10 ms by default).
 * Much slower tails (τ ≥ 30 ms) sit at the 5.0 crest-factor limit of §3.12.
 */
export function clap(sampleRate: number, rng: Rng, options: BurstOptions = {}): Float32Array {
  const { levelDb = -12, attackMs = 2, decayMs = 10, lengthMs = 120, highPassHz = 400 } = options;
  const noise = highPass(whiteNoise(lengthMs, sampleRate, 0, rng), highPassHz, sampleRate);
  const amp = dbToAmp(levelDb);
  const attack = msToSamples(attackMs, sampleRate);
  const tau = (decayMs * sampleRate) / 1000;
  return noise.map((x, i) => {
    const env = i < attack ? i / attack : Math.exp(-(i - attack) / tau);
    return amp * env * x;
  });
}

/** Key click: a tiny, very fast-decaying burst with a resonant ring. */
export function keyClick(sampleRate: number, rng: Rng, levelDb = -28): Float32Array {
  const burst = clap(sampleRate, rng, { levelDb, attackMs: 0.3, decayMs: 1.5, lengthMs: 25, highPassHz: 800 });
  const ring = Float32Array.from({ length: burst.length }, (_, i) =>
    0.3 * dbToAmp(levelDb) * Math.exp(-i / (0.004 * sampleRate)) * Math.sin((2 * Math.PI * 3200 * i) / sampleRate));
  return burst.map((x, i) => x + ring[i]);
}

/** Vowel-like harmonic tone with formant weighting and soft attack/release. */
export function vowel(sampleRate: number, ms: number, options: { f0?: number; levelDb?: number } = {}): Float32Array {
  const { f0 = 140, levelDb = -20 } = options;
  const formants = [700, 1200, 2600];
  const harmonics = Array.from({ length: Math.floor(5000 / f0) }, (_, h) => (h + 1) * f0);
  const weights = harmonics.map((f) => formants.reduce((w, fm) => w + Math.exp(-(((f - fm) / 180) ** 2)), 0.02));
  const norm = Math.sqrt(weights.reduce((s, w) => s + (w * w) / 2, 0));
  const amp = dbToAmp(levelDb) / norm;
  const n = msToSamples(ms, sampleRate);
  const ramp = msToSamples(15, sampleRate);
  return Float32Array.from({ length: n }, (_, i) => {
    const env = Math.min(1, i / ramp, (n - i) / ramp);
    const t = i / sampleRate;
    const sum = harmonics.reduce((s, f, h) => s + weights[h] * Math.sin(2 * Math.PI * f * t + h), 0);
    return amp * env * sum;
  });
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Returns a copy of `base` with `insert` added at `atMs`. */
export function mixAt(base: Float32Array, insert: Float32Array, atMs: number, sampleRate: number): Float32Array {
  const out = base.slice();
  const start = msToSamples(atMs, sampleRate);
  for (let i = 0; i < insert.length && start + i < out.length; i += 1) out[start + i] += insert[i];
  return out;
}

/** Background noise of `ms` with each insert placed at its time. */
export function scene(
  sampleRate: number,
  ms: number,
  rng: Rng,
  backgroundDb: number,
  inserts: readonly { readonly atMs: number; readonly signal: Float32Array }[],
): Float32Array {
  const base = whiteNoise(ms, sampleRate, backgroundDb, rng);
  return inserts.reduce((acc, ins) => mixAt(acc, ins.signal, ins.atMs, sampleRate), base);
}

/** RMS in dBFS of a range. */
export function levelDb(samples: Float32Array, start = 0, end = samples.length): number {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / Math.max(1, end - start) + 1e-20);
}

/** Feeds a signal in fixed-size chunks (as the worklet does) and collects the results. */
export function chunked<T>(signal: Float32Array, size: number, feed: (chunk: Float32Array) => T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < signal.length; i += size) out.push(...feed(signal.subarray(i, Math.min(signal.length, i + size))));
  return out;
}
