/**
 * Small radix-2 FFT for real input frames. Scratch buffers are owned by the instance and reused
 * across calls (audio runs ~200 frames/s); inputs are never modified.
 */

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/** Periodic Hann window (the right choice for spectral analysis with overlap). */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

/** Mean of w² — converts windowed spectral power back to signal power. */
export function windowPowerGain(window: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < window.length; i += 1) sum += window[i] * window[i];
  return sum / window.length;
}

export class Fft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size) || size < 4) throw new Error(`FFT size must be a power of two ≥ 4, got ${size}`);
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    this.reversed = bitReversalTable(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  /**
   * Writes |X_k|² for k = 0 … size/2 of `frame · window` into `out` (length ≥ size/2 + 1)
   * and returns it. `frame` must hold at least `size` samples.
   */
  powerSpectrum(frame: ArrayLike<number>, window: Float64Array, out: Float64Array): Float64Array {
    const { size, re, im, reversed } = this;
    for (let i = 0; i < size; i += 1) {
      const j = reversed[i];
      re[j] = frame[i] * window[i];
      im[j] = 0;
    }
    this.transform();
    for (let k = 0; k <= size / 2; k += 1) out[k] = re[k] * re[k] + im[k] * im[k];
    return out;
  }

  private transform(): void {
    const { size, re, im, cos, sin } = this;
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;
      for (let start = 0; start < size; start += len) {
        for (let k = 0; k < half; k += 1) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

function bitReversalTable(size: number): Uint32Array {
  const bits = Math.log2(size);
  const table = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    table[i] = r;
  }
  return table;
}

/** FFT bin index nearest to a frequency, clamped to the valid range. */
export function binForHz(hz: number, fftSize: number, sampleRate: number): number {
  const bin = Math.round((hz * fftSize) / sampleRate);
  return Math.min(fftSize / 2, Math.max(0, bin));
}
