/**
 * Fixed-capacity sample history addressed by absolute sample index (0 = first sample ever written).
 * Owned by one DSP stage; callers read copies, never the backing store.
 */
export class RingBuffer {
  readonly capacity: number;
  private readonly data: Float32Array;
  private written = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error(`Invalid ring capacity ${capacity}`);
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
  }

  /** Total samples ever written; also the absolute index of the next sample. */
  get total(): number {
    return this.written;
  }

  /** Oldest absolute index still available. */
  get oldest(): number {
    return Math.max(0, this.written - this.capacity);
  }

  write(input: Float32Array): void {
    const start = input.length > this.capacity ? input.length - this.capacity : 0;
    for (let i = start; i < input.length; i += 1) this.data[(this.written + i) % this.capacity] = input[i];
    this.written += input.length;
  }

  /** Copies samples [start, start + length) into `out` (default: a new array); missing samples read as 0. */
  read(start: number, length: number, out: Float32Array = new Float32Array(length)): Float32Array {
    const oldest = this.oldest;
    for (let i = 0; i < length; i += 1) {
      const index = start + i;
      out[i] = index >= oldest && index < this.written ? this.data[index % this.capacity] : 0;
    }
    return out;
  }

  /** The most recent `length` samples (zero-padded at the front if fewer were written). */
  latest(length: number, out?: Float32Array): Float32Array {
    return this.read(this.written - length, length, out);
  }
}
