import { describe, expect, it } from 'vitest';
import { ClapDetector, type ClapDetection } from '@renderer/engine/dsp/clap';
import { PercentileTracker } from '@renderer/engine/dsp/clap-features';
import type { ClapSensitivity } from '@renderer/engine/dsp/tuning';
import { chunked, clap, keyClick, mulberry32, scene, vowel, whiteNoise, type Rng } from '../synth';

const SR = 48_000;
const QUIET_DB = -75;

function detect(signal: Float32Array, sensitivity: ClapSensitivity = 'medium', chunk = 1024, suppressed = false): ClapDetection[] {
  const detector = new ClapDetector({ sampleRate: SR, sensitivity });
  return chunked(signal, chunk, (c) => detector.process(c, suppressed));
}

function clapsAt(rng: Rng, times: readonly number[], levelDb = -12): { atMs: number; signal: Float32Array }[] {
  return times.map((atMs) => ({ atMs, signal: clap(SR, rng, { levelDb }) }));
}

describe('ClapDetector', () => {
  it('detects exactly one double clap 300 ms apart in a quiet room', () => {
    // Arrange
    const rng = mulberry32(1);
    const signal = scene(SR, 3500, rng, QUIET_DB, clapsAt(rng, [1500, 1800]));

    // Act
    const detections = detect(signal);

    // Assert
    expect(detections).toHaveLength(1);
    expect(detections[0].firstMs).toBeGreaterThan(1490);
    expect(detections[0].firstMs).toBeLessThan(1530);
    expect(detections[0].secondMs - detections[0].firstMs).toBeGreaterThan(280);
    expect(detections[0].secondMs - detections[0].firstMs).toBeLessThan(320);
    expect(detections[0].atMs).toBeGreaterThanOrEqual(detections[0].secondMs + 350);
  });

  it('detects double claps at many sub-hop offsets and seeds', () => {
    // Arrange
    const offsets = [0, 1.3, 2.7, 3.9, 5.1];
    const results = offsets.map((offset, i) => {
      const rng = mulberry32(100 + i);
      const signal = scene(SR, 3000, rng, QUIET_DB, clapsAt(rng, [1200 + offset, 1600 + offset * 2]));
      // Act
      return detect(signal).length;
    });

    // Assert
    expect(results).toEqual(offsets.map(() => 1));
  });

  it('ignores a single clap', () => {
    const rng = mulberry32(2);
    const signal = scene(SR, 3000, rng, QUIET_DB, clapsAt(rng, [1500]));
    expect(detect(signal)).toHaveLength(0);
  });

  it('ignores three claps in a row (applause) although the first two alone would count', () => {
    // Arrange
    const claps = clapsAt(mulberry32(3), [1200, 1450, 1700]);
    const triple = scene(SR, 3500, mulberry32(30), QUIET_DB, claps);
    const pairOnly = scene(SR, 3500, mulberry32(30), QUIET_DB, claps.slice(0, 2));

    // Act + Assert
    expect(detect(pairOnly)).toHaveLength(1);
    expect(detect(triple)).toHaveLength(0);
  });

  it('ignores a long run of applause', () => {
    const rng = mulberry32(4);
    const times = Array.from({ length: 10 }, (_, i) => 1000 + i * 210 + Math.round(rng() * 40));
    const signal = scene(SR, 4500, rng, QUIET_DB, clapsAt(rng, times));
    expect(detect(signal)).toHaveLength(0);
  });

  it('ignores claps one second apart', () => {
    const rng = mulberry32(5);
    const signal = scene(SR, 4000, rng, QUIET_DB, clapsAt(rng, [1200, 2200]));
    expect(detect(signal)).toHaveLength(0);
  });

  it('ignores claps too close together (under 150 ms)', () => {
    const rng = mulberry32(6);
    const signal = scene(SR, 3000, rng, QUIET_DB, clapsAt(rng, [1200, 1320]));
    expect(detect(signal)).toHaveLength(0);
  });

  it('ignores a pair whose peaks differ by more than 8 dB', () => {
    const rng = mulberry32(7);
    const signal = scene(SR, 3000, rng, QUIET_DB, [
      { atMs: 1200, signal: clap(SR, rng, { levelDb: -10 }) },
      { atMs: 1500, signal: clap(SR, rng, { levelDb: -24 }) },
    ]);
    expect(detect(signal)).toHaveLength(0);
  });

  it('ignores vowel-like speech bursts', () => {
    const rng = mulberry32(8);
    const syllables = [1000, 1250, 1500, 1900, 2150, 2600].map((atMs, i) => ({
      atMs,
      signal: vowel(SR, 180, { f0: 120 + i * 15, levelDb: -18 }),
    }));
    const pair = [{ atMs: 1000, signal: vowel(SR, 120, { levelDb: -14 }) }, { atMs: 1350, signal: vowel(SR, 120, { levelDb: -14 }) }];
    expect(detect(scene(SR, 3500, rng, QUIET_DB, syllables))).toHaveLength(0);
    expect(detect(scene(SR, 3000, rng, QUIET_DB, pair))).toHaveLength(0);
  });

  it('ignores a rapid run of keyboard clicks', () => {
    const rng = mulberry32(9);
    let t = 1000;
    const clicks = Array.from({ length: 14 }, () => {
      t += 90 + Math.round(rng() * 110);
      return { atMs: t, signal: keyClick(SR, rng) };
    });
    expect(detect(scene(SR, 4500, rng, QUIET_DB, clicks))).toHaveLength(0);
  });

  it('still detects a double clap over moderate white noise (-50 dBFS)', () => {
    const rng = mulberry32(10);
    const signal = scene(SR, 3500, rng, -50, clapsAt(rng, [1500, 1850]));
    expect(detect(signal)).toHaveLength(1);
  });

  it('stays silent over steady white noise alone', () => {
    const rng = mulberry32(11);
    expect(detect(whiteNoise(5000, SR, -45, rng))).toHaveLength(0);
  });

  it('pauses when the room is louder than -35 dBFS', () => {
    const rng = mulberry32(12);
    const signal = scene(SR, 3500, rng, -25, clapsAt(rng, [1500, 1800], 0));
    expect(detect(signal)).toHaveLength(0);
  });

  it('detects nothing while suppressed', () => {
    const rng = mulberry32(13);
    const signal = scene(SR, 3500, rng, QUIET_DB, clapsAt(rng, [1500, 1800]));
    expect(detect(signal, 'medium', 1024, true)).toHaveLength(0);
  });

  it('requires isolation after suppression ends', () => {
    // Arrange: suppressed for the first 1.4 s, first clap 100 ms later.
    const rng = mulberry32(14);
    const signal = scene(SR, 3500, rng, QUIET_DB, clapsAt(rng, [1500, 1800]));
    const detector = new ClapDetector({ sampleRate: SR, sensitivity: 'medium' });
    const cut = Math.round(1.4 * SR);

    // Act
    const during = detector.process(signal.subarray(0, cut), true);
    const after = detector.process(signal.subarray(cut), false);

    // Assert
    expect([...during, ...after]).toHaveLength(0);
  });

  it('cools down for 1.5 s after a detection', () => {
    const rng = mulberry32(15);
    const signal = scene(SR, 5000, rng, QUIET_DB, clapsAt(rng, [1200, 1500, 2500, 2800]));
    expect(detect(signal)).toHaveLength(1);
  });

  it('detects two double claps separated by more than the cooldown', () => {
    const rng = mulberry32(16);
    const signal = scene(SR, 6500, rng, QUIET_DB, clapsAt(rng, [1200, 1500, 4000, 4300]));
    expect(detect(signal)).toHaveLength(2);
  });

  it('gives identical results regardless of chunk size', () => {
    const rng = mulberry32(17);
    const signal = scene(SR, 3500, rng, -60, clapsAt(rng, [1500, 1800]));
    expect(detect(signal, 'medium', 128)).toEqual(detect(signal, 'medium', 4096));
  });

  it('orders sensitivities: high detects quieter claps than medium, medium than low', () => {
    // Arrange: claps at decreasing prominence over a -50 dBFS noise floor.
    const levels = [-20, -24, -28, -30, -32, -34, -36, -38, -40];
    const detectedAt = (sensitivity: ClapSensitivity) => levels.filter((level, i) => {
      const rng = mulberry32(200 + i);
      const signal = scene(SR, 3500, rng, -50, clapsAt(rng, [1500, 1850], level));
      return detect(signal, sensitivity).length === 1;
    });

    // Act
    const low = detectedAt('low');
    const medium = detectedAt('medium');
    const high = detectedAt('high');

    // Assert
    expect(low.every((l) => medium.includes(l))).toBe(true);
    expect(medium.every((l) => high.includes(l))).toBe(true);
    expect(high.length).toBeGreaterThan(low.length);
    expect(Math.min(...high)).toBeLessThan(Math.min(...low));
  });

  it('exposes a floor that tracks the background level', () => {
    const rng = mulberry32(18);
    const detector = new ClapDetector({ sampleRate: SR, sensitivity: 'medium' });
    detector.process(whiteNoise(3000, SR, -40, rng));
    // White noise at -40 dBFS puts 6/24 of its power in 2–8 kHz: about -46 dB.
    expect(detector.floorDb).toBeGreaterThan(-49);
    expect(detector.floorDb).toBeLessThan(-43);
  });

  it('works at 44.1 kHz', () => {
    const rate = 44_100;
    const rng = mulberry32(19);
    const signal = scene(rate, 3500, rng, QUIET_DB, [1500, 1800].map((atMs) => ({ atMs, signal: clap(rate, rng) })));
    const detector = new ClapDetector({ sampleRate: rate, sensitivity: 'low' });
    expect(chunked(signal, 1024, (c) => detector.process(c))).toHaveLength(1);
  });

  it('rejects an invalid sample rate', () => {
    expect(() => new ClapDetector({ sampleRate: 0, sensitivity: 'medium' })).toThrow();
  });
});

describe('PercentileTracker', () => {
  it('returns the fallback when empty and the percentile of the last values', () => {
    const tracker = new PercentileTracker(5, 0.2);
    expect(tracker.value(-70)).toBe(-70);
    [5, 1, 4, 2, 3, 100, 200].forEach((v) => tracker.push(v));
    // Window holds 4, 2, 3, 100, 200 → 20th percentile = second smallest of 5 → 3.
    expect(tracker.value(0)).toBe(3);
    expect(tracker.size).toBe(5);
  });
});
