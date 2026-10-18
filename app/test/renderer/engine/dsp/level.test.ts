import { describe, expect, it } from 'vitest';
import {
  LevelMeter, SILENT_FOLLOWER, SILENT_LEVEL, bandEdges, clamp01, dbToUnit, follow, rmsDb, syntheticSpeechLevel,
} from '@renderer/engine/dsp/level';
import { LEVEL } from '@renderer/engine/dsp/tuning';
import { mulberry32, silence, tone, whiteNoise } from '../synth';

const SR = 48_000;

describe('level helpers', () => {
  it('maps dB linearly onto 0..1 and clamps', () => {
    expect(dbToUnit(-60, -60, -10)).toBe(0);
    expect(dbToUnit(-35, -60, -10)).toBe(0.5);
    expect(dbToUnit(0, -60, -10)).toBe(1);
    expect(dbToUnit(-90, -60, -10)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it('follows with 0.75/0.25 smoothing and a 0.9 peak decay', () => {
    const rising = follow(SILENT_FOLLOWER, 1);
    expect(rising.smoothed).toBeCloseTo(0.25);
    expect(rising.envelope).toBeCloseTo(0.25);
    const held = follow({ smoothed: 0.1, envelope: 0.8 }, 0);
    expect(held.smoothed).toBeCloseTo(0.075);
    expect(held.envelope).toBeCloseTo(0.72);
  });

  it('computes RMS in dBFS', () => {
    expect(rmsDb(tone(1000, 100, SR, -20))).toBeCloseTo(-20, 1);
    expect(rmsDb(new Float32Array(0))).toBe(-Infinity);
  });

  it('spaces band edges logarithmically', () => {
    const edges = bandEdges(12, 80, 8000);
    expect(edges).toHaveLength(13);
    expect(edges[0]).toBeCloseTo(80);
    expect(edges[12]).toBeCloseTo(8000);
    expect(edges[1] / edges[0]).toBeCloseTo(edges[12] / edges[11]);
  });
});

describe('LevelMeter', () => {
  it('rises toward the perceptual level of a steady tone and stays within 0..1', () => {
    // Arrange: -35 dBFS sits in the middle of the -60..-10 scale.
    const meter = new LevelMeter(SR);
    const block = tone(1000, 21, SR, -35);

    // Act
    for (let i = 0; i < 40; i += 1) meter.push(block);
    const { level, bands } = meter.read();

    // Assert
    expect(level).toBeCloseTo(0.5, 1);
    expect(bands).toHaveLength(LEVEL.bandCount);
    bands.forEach((b) => {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    });
  });

  it('lights the band that contains a tone more than distant bands', () => {
    const meter = new LevelMeter(SR);
    for (let i = 0; i < 20; i += 1) meter.push(tone(1000, 21, SR, -20));
    let bands: readonly number[] = [];
    for (let i = 0; i < 10; i += 1) bands = meter.read().bands;
    const edges = bandEdges(LEVEL.bandCount, LEVEL.bandMinHz, LEVEL.bandMaxHz);
    const toneBand = edges.findIndex((e, i) => e <= 1000 && edges[i + 1] > 1000);
    expect(bands[toneBand]).toBeGreaterThan(0.5);
    expect(bands[0]).toBeLessThan(bands[toneBand] / 2);
    expect(bands[LEVEL.bandCount - 1]).toBeLessThan(bands[toneBand] / 2);
  });

  it('decays smoothly back to silence instead of dropping instantly', () => {
    const meter = new LevelMeter(SR);
    for (let i = 0; i < 20; i += 1) meter.push(whiteNoise(21, SR, -20, mulberry32(i)));
    const loud = meter.read().level;
    meter.push(silence(21, SR));
    const next = meter.read().level;
    expect(next).toBeLessThan(loud);
    expect(next).toBeGreaterThan(loud * 0.85);
    meter.reset();
    expect(meter.read().level).toBe(0);
  });

  it('ignores empty blocks', () => {
    const meter = new LevelMeter(SR);
    meter.push(new Float32Array(0));
    expect(meter.read().level).toBe(0);
  });
});

describe('syntheticSpeechLevel', () => {
  it('is deterministic, bounded and moves over time', () => {
    const a = syntheticSpeechLevel(1234);
    expect(syntheticSpeechLevel(1234)).toEqual(a);
    const levels = Array.from({ length: 30 }, (_, i) => syntheticSpeechLevel(i * 33).level);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.2);
    [...levels, ...a.bands].forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
    expect(a.bands).toHaveLength(LEVEL.bandCount);
    expect(syntheticSpeechLevel(0, 1).bands).toHaveLength(1);
  });

  it('has a silent constant with the right number of bands', () => {
    expect(SILENT_LEVEL.level).toBe(0);
    expect(SILENT_LEVEL.bands).toHaveLength(LEVEL.bandCount);
  });
});
