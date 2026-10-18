import { describe, expect, it } from 'vitest';
import { Resampler, besselI0, resample } from '@renderer/engine/dsp/resampler';
import { concat, levelDb, mulberry32, tone, whiteNoise } from '../synth';

/** RMS of the middle of a signal (skips filter edges). */
const steadyDb = (signal: Float32Array) => levelDb(signal, Math.floor(signal.length * 0.2), Math.floor(signal.length * 0.8));

describe('Resampler', () => {
  it('keeps a 1 kHz tone intact from 48 kHz to 16 kHz', () => {
    // Arrange
    const input = tone(1000, 500, 48_000, -20);

    // Act
    const output = resample(input, 48_000, 16_000);

    // Assert
    expect(output.length).toBe(Math.ceil(input.length / 3));
    expect(steadyDb(output)).toBeCloseTo(-20, 0);
  });

  it('attenuates a 7.9 kHz tone (no naive-decimation leakage) at 48 kHz → 16 kHz', () => {
    const output = resample(tone(7900, 500, 48_000, -20), 48_000, 16_000);
    expect(steadyDb(output)).toBeLessThan(-20 - 40);
  });

  it('does not alias out-of-band content into the speech band', () => {
    // 10 kHz at 48 kHz would fold to 6 kHz with plain decimation.
    const output = resample(tone(10_000, 500, 48_000, -20), 48_000, 16_000);
    expect(steadyDb(output)).toBeLessThan(-20 - 60);
  });

  it('handles 44.1 kHz input (rational 160/441) with the right length and gain', () => {
    const input = tone(1000, 400, 44_100, -20);
    const output = resample(input, 44_100, 16_000);
    expect(output.length).toBe(Math.ceil((input.length * 160) / 441));
    expect(steadyDb(output)).toBeCloseTo(-20, 0);
  });

  it('upsamples 8 kHz to 16 kHz without changing the level', () => {
    const output = resample(tone(500, 400, 8000, -20), 8000, 16_000);
    expect(steadyDb(output)).toBeCloseTo(-20, 0);
  });

  it('passes audio through untouched when the rates match', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3]);
    const r = new Resampler(16_000, 16_000);
    const out = r.push(input);
    expect([...out]).toEqual([...input]);
    expect(out).not.toBe(input);
    expect(r.flush().length).toBe(0);
  });

  it('produces the same output whether fed in one block or in worklet-sized chunks', () => {
    // Arrange
    const input = whiteNoise(300, 48_000, -20, mulberry32(3));
    const whole = resample(input, 48_000, 16_000);
    const r = new Resampler(48_000, 16_000);

    // Act
    const parts: Float32Array[] = [];
    for (let i = 0; i < input.length; i += 1024) parts.push(r.push(input.subarray(i, i + 1024)));
    parts.push(r.flush());
    const streamed = concat(...parts);

    // Assert
    expect(streamed.length).toBe(whole.length);
    streamed.forEach((v, i) => expect(v).toBeCloseTo(whole[i], 6));
  });

  it('quantises phases for rates with a very large up-factor', () => {
    // 16000/44056 has an up-factor of 2000 (> maxPhases): still a clean 1 kHz tone.
    const output = resample(tone(1000, 300, 44_056, -20), 44_056, 16_000);
    expect(steadyDb(output)).toBeCloseTo(-20, 0);
  });

  it('refuses input after flush and returns nothing on a second flush', () => {
    const r = new Resampler(48_000, 16_000);
    r.flush();
    expect(r.flush().length).toBe(0);
    expect(() => r.push(new Float32Array(10))).toThrow(/flushed/);
  });

  it('rejects non-positive rates', () => {
    expect(() => new Resampler(0, 16_000)).toThrow();
  });
});

describe('besselI0', () => {
  it('matches known values', () => {
    expect(besselI0(0)).toBe(1);
    expect(besselI0(1)).toBeCloseTo(1.2660658777, 8);
    expect(besselI0(5)).toBeCloseTo(27.239871823, 6);
  });
});
