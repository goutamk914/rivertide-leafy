import { describe, expect, it } from 'vitest';
import { Fft, binForHz, hannWindow, isPowerOfTwo, windowPowerGain } from '@renderer/engine/dsp/fft';
import { appendBounded, keepLast } from '@renderer/engine/dsp/history';
import { RingBuffer } from '@renderer/engine/dsp/ring-buffer';
import { tone } from '../synth';

describe('Fft', () => {
  it('puts a bin-centred sine into that bin with the Hann coherent gain', () => {
    // Arrange: 8 cycles in 512 samples → bin 8.
    const n = 512;
    const frame = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 8 * i) / n));
    const fft = new Fft(n);

    // Act
    const p = fft.powerSpectrum(frame, hannWindow(n), new Float64Array(n / 2 + 1));

    // Assert: |X| = A·N/4 for a Hann-windowed sine.
    expect(Math.sqrt(p[8])).toBeCloseTo(n / 4, 4);
    expect(p[20]).toBeLessThan(1e-9);
  });

  it('satisfies Parseval for an unwindowed frame', () => {
    const n = 64;
    const frame = tone(1234, 4, 16_000, -10).slice(0, n);
    const rect = new Float64Array(n).fill(1);
    const p = new Fft(n).powerSpectrum(frame, rect, new Float64Array(n / 2 + 1));
    const timeEnergy = frame.reduce((s, v) => s + v * v, 0);
    const freqEnergy = (p[0] + p[n / 2] + 2 * p.slice(1, n / 2).reduce((s, v) => s + v, 0)) / n;
    expect(freqEnergy).toBeCloseTo(timeEnergy, 6);
  });

  it('rejects sizes that are not powers of two', () => {
    expect(() => new Fft(100)).toThrow(/power of two/);
    expect(isPowerOfTwo(256)).toBe(true);
    expect(isPowerOfTwo(0)).toBe(false);
  });

  it('has a Hann power gain of 3/8 and clamps bin lookups', () => {
    expect(windowPowerGain(hannWindow(512))).toBeCloseTo(0.375, 6);
    expect(binForHz(1000, 512, 48_000)).toBe(11);
    expect(binForHz(30_000, 512, 48_000)).toBe(256);
    expect(binForHz(-5, 512, 48_000)).toBe(0);
  });
});

describe('RingBuffer', () => {
  it('reads by absolute index and zero-fills what is missing or overwritten', () => {
    const ring = new RingBuffer(4);
    ring.write(Float32Array.from([1, 2, 3]));
    ring.write(Float32Array.from([4, 5]));
    expect(ring.total).toBe(5);
    expect(ring.oldest).toBe(1);
    expect([...ring.read(0, 6)]).toEqual([0, 2, 3, 4, 5, 0]);
    expect([...ring.latest(2)]).toEqual([4, 5]);
  });

  it('keeps the tail of a write larger than its capacity', () => {
    const ring = new RingBuffer(3);
    ring.write(Float32Array.from([1, 2, 3, 4, 5]));
    expect([...ring.latest(3)]).toEqual([3, 4, 5]);
  });

  it('rejects an invalid capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});

describe('history helpers', () => {
  it('keeps the last n items without the slice(-0) trap', () => {
    expect(keepLast([1, 2, 3], 2)).toEqual([2, 3]);
    expect(keepLast([1, 2, 3], 0)).toEqual([]);
    expect(appendBounded([1, 2, 3], 4, 1)).toEqual([4]);
    expect(appendBounded([1, 2], 3, 5)).toEqual([1, 2, 3]);
  });
});
