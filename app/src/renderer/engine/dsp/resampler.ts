/**
 * Streaming rational resampler: Kaiser-windowed sinc low-pass evaluated as a polyphase table.
 * For 48 kHz → 16 kHz the passband ends at 6.8 kHz and everything above 7.8 kHz is attenuated
 * by ~80 dB, so nothing aliases (naive decimation would fold 8–24 kHz straight into speech).
 * Output sample n sits at input time n·M/L; the filter is symmetric, so there is no delay.
 */
import { RESAMPLER } from './tuning';

type ResamplerTuning = typeof RESAMPLER;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/** Zeroth-order modified Bessel function of the first kind (series), for the Kaiser window. */
export function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k += 1) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

function kaiserBeta(attenuationDb: number): number {
  if (attenuationDb > 50) return 0.1102 * (attenuationDb - 8.7);
  if (attenuationDb >= 21) return 0.5842 * (attenuationDb - 21) ** 0.4 + 0.07886 * (attenuationDb - 21);
  return 0;
}

interface FilterTable {
  readonly halfWidth: number;
  readonly phases: number;
  /** phases × (2·halfWidth) coefficients; row φ applies to x[i − H + 1 … i + H]. */
  readonly coefficients: Float32Array;
}

function designTable(inputRate: number, outputRate: number, upFactor: number, tuning: ResamplerTuning): FilterTable {
  const nyquist = Math.min(inputRate, outputRate) / 2;
  const pass = nyquist * tuning.passbandRatio;
  const stop = nyquist * tuning.stopbandRatio;
  const cutoff = (pass + stop) / 2 / inputRate; // cycles per input sample
  const transition = (2 * Math.PI * (stop - pass)) / inputRate;
  const taps = Math.ceil((tuning.attenuationDb - 8) / (2.285 * transition));
  const halfWidth = Math.max(2, Math.ceil(taps / 2));
  const beta = kaiserBeta(tuning.attenuationDb);
  const i0Beta = besselI0(beta);
  const phases = Math.min(upFactor, tuning.maxPhases);
  const width = 2 * halfWidth;
  const coefficients = new Float32Array(phases * width);
  for (let p = 0; p < phases; p += 1) {
    let sum = 0;
    const row = new Float64Array(width);
    for (let j = 0; j < width; j += 1) {
      const tau = halfWidth - 1 - j + p / phases;
      const ratio = tau / halfWidth;
      const window = Math.abs(ratio) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - ratio * ratio)) / i0Beta;
      const x = 2 * cutoff * tau;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      row[j] = 2 * cutoff * sinc * window;
      sum += row[j];
    }
    for (let j = 0; j < width; j += 1) coefficients[p * width + j] = row[j] / sum; // unity DC gain per phase
  }
  return { halfWidth, phases, coefficients };
}

export class Resampler {
  readonly inputRate: number;
  readonly outputRate: number;
  private readonly up: number;
  private readonly down: number;
  private readonly table: FilterTable | null;
  /** Input samples from absolute index `bufferStart` (may be negative: leading zeros). */
  private buffer: Float32Array;
  private bufferStart: number;
  private inputCount = 0;
  private outputCount = 0;
  private flushed = false;

  constructor(inputRate: number, outputRate: number, tuning: ResamplerTuning = RESAMPLER) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error('Sample rates must be positive.');
    const g = gcd(Math.round(inputRate), Math.round(outputRate));
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.up = Math.round(outputRate) / g;
    this.down = Math.round(inputRate) / g;
    this.table = this.up === this.down ? null : designTable(inputRate, outputRate, this.up, tuning);
    const half = this.table?.halfWidth ?? 0;
    this.buffer = new Float32Array(half);
    this.bufferStart = -half;
  }

  /** Feeds input; returns every output sample that is now fully determined. */
  push(input: Float32Array): Float32Array {
    if (this.flushed) throw new Error('Resampler already flushed.');
    if (!this.table) return input.slice();
    this.append(input);
    this.inputCount += input.length;
    return this.produce(this.inputCount - this.table.halfWidth);
  }

  /** Ends the stream: returns the remaining outputs (zero-padded tail). */
  flush(): Float32Array {
    if (this.flushed) return new Float32Array(0);
    this.flushed = true;
    if (!this.table) return new Float32Array(0);
    this.append(new Float32Array(this.table.halfWidth));
    const total = Math.ceil((this.inputCount * this.up) / this.down);
    return this.produce(this.inputCount, total);
  }

  private append(input: Float32Array): void {
    const next = new Float32Array(this.buffer.length + input.length);
    next.set(this.buffer);
    next.set(input, this.buffer.length);
    this.buffer = next;
  }

  /** Computes outputs whose centre index i satisfies i < `limit` (and n < `maxOutputs`). */
  private produce(limit: number, maxOutputs = Number.POSITIVE_INFINITY): Float32Array {
    const table = this.table as FilterTable;
    const { halfWidth, phases, coefficients } = table;
    const width = 2 * halfWidth;
    const results: number[] = [];
    for (;;) {
      const n = this.outputCount;
      if (n >= maxOutputs) break;
      const position = n * this.down;
      const center = Math.floor(position / this.up);
      if (center >= limit) break;
      const phase = this.up <= phases
        ? position % this.up
        : Math.min(phases - 1, Math.floor(((position % this.up) * phases) / this.up));
      const offset = center - halfWidth + 1 - this.bufferStart;
      const row = phase * width;
      let acc = 0;
      for (let j = 0; j < width; j += 1) acc += this.buffer[offset + j] * coefficients[row + j];
      results.push(acc);
      this.outputCount = n + 1;
    }
    this.discardConsumed(halfWidth);
    return Float32Array.from(results);
  }

  private discardConsumed(halfWidth: number): void {
    const nextCenter = Math.floor((this.outputCount * this.down) / this.up);
    const keepFrom = nextCenter - halfWidth + 1;
    const drop = keepFrom - this.bufferStart;
    if (drop <= 0) return;
    this.buffer = this.buffer.slice(Math.min(drop, this.buffer.length));
    this.bufferStart += drop;
  }
}

/** One-shot convenience for whole buffers. */
export function resample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  const r = new Resampler(inputRate, outputRate);
  const head = r.push(input);
  const tail = r.flush();
  const out = new Float32Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
}
