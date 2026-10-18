import { describe, expect, it } from 'vitest';
import { Vad, frameFeatures, mergeSegments, powerToDb, type EndpointingConfig } from '@renderer/engine/dsp/vad';
import { concat, mulberry32, silence, tone, vowel, whiteNoise, type Rng } from '../synth';

const SR = 16_000;
const HANDS_FREE: EndpointingConfig = { enabled: true, endSilenceMs: 1000, noSpeechTimeoutMs: 3000 };
const PUSH_TO_TALK: EndpointingConfig = { enabled: false, endSilenceMs: 1000, noSpeechTimeoutMs: 3000 };
const TEN_MINUTES = 600_000;

const quiet = (ms: number, rng: Rng) => whiteNoise(ms, SR, -70, rng);
const speech = (ms: number) => vowel(SR, ms, { f0: 130, levelDb: -24 });

function analyse(signal: Float32Array) {
  const vad = new Vad(SR);
  vad.push(signal);
  return vad.finish();
}

/** Feeds 20 ms blocks and returns the first stop decision with its time. */
function firstDecision(signal: Float32Array, config: EndpointingConfig, maxDurationMs = TEN_MINUTES) {
  const vad = new Vad(SR);
  const block = SR / 50;
  for (let i = 0; i < signal.length; i += block) {
    vad.push(signal.subarray(i, i + block));
    const reason = vad.decide(config, maxDurationMs);
    if (reason) return { reason, atMs: vad.elapsedMs };
  }
  return null;
}

describe('Vad', () => {
  it('finds no speech in digital silence or a quiet room', () => {
    const rng = mulberry32(1);
    for (const signal of [silence(3000, SR), quiet(3000, rng)]) {
      const summary = analyse(signal);
      expect(summary.hasSpeech).toBe(false);
      expect(summary.stats.segments).toBe(0);
      expect(summary.stats.speechMs).toBe(0);
      expect(summary.stats.speechLevelDb).toBe(-100);
      expect(summary.stats.durationMs).toBe(3000);
    }
  });

  it('counts segments and pauses for bursts separated by gaps', () => {
    // Arrange: 3 × 400 ms of voice with 500 ms gaps.
    const rng = mulberry32(2);
    const signal = concat(quiet(500, rng), speech(400), quiet(500, rng), speech(400), quiet(500, rng), speech(400), quiet(500, rng));

    // Act
    const { stats, segmentsMs } = analyse(signal);

    // Assert
    expect(stats.segments).toBe(3);
    expect(stats.pauseCount).toBe(2);
    expect(stats.longPauseCount).toBe(0);
    expect(stats.meanPauseMs).toBeGreaterThan(440);
    expect(stats.meanPauseMs).toBeLessThan(560);
    expect(stats.speechMs).toBeGreaterThan(1080);
    expect(stats.speechMs).toBeLessThan(1260);
    expect(segmentsMs[0].startMs).toBeGreaterThanOrEqual(480);
    expect(segmentsMs[0].startMs).toBeLessThanOrEqual(540);
    expect(stats.speechLevelDb).toBeGreaterThan(-28);
    expect(stats.speechLevelDb).toBeLessThan(-20);
  });

  it('treats gaps shorter than 250 ms as part of one segment', () => {
    const rng = mulberry32(3);
    const signal = concat(quiet(400, rng), speech(300), quiet(150, rng), speech(300), quiet(400, rng));
    const { stats } = analyse(signal);
    expect(stats.segments).toBe(1);
    expect(stats.pauseCount).toBe(0);
  });

  it('reports long pauses over 2 s and the longest pause', () => {
    const rng = mulberry32(4);
    const signal = concat(quiet(300, rng), speech(300), quiet(2500, rng), speech(300), quiet(600, rng), speech(300), quiet(300, rng));
    const { stats } = analyse(signal);
    expect(stats.pauseCount).toBe(2);
    expect(stats.longPauseCount).toBe(1);
    expect(stats.maxPauseMs).toBeGreaterThan(2400);
    expect(stats.maxPauseMs).toBeLessThan(2600);
  });

  it('ignores clicks shorter than the minimum speech length', () => {
    const rng = mulberry32(5);
    const signal = concat(quiet(500, rng), tone(1000, 30, SR, -20), quiet(1000, rng));
    expect(analyse(signal).hasSpeech).toBe(false);
  });

  it('detects speech that starts in the very first frame', () => {
    const rng = mulberry32(6);
    const { stats, segmentsMs } = analyse(concat(speech(600), quiet(800, rng)));
    expect(stats.segments).toBe(1);
    expect(segmentsMs[0].startMs).toBe(0);
  });

  it('keeps quiet unvoiced sounds inside a segment (zero-crossing rate)', () => {
    // Arrange: a vowel, then "s"-like noise only 7 dB over the floor, then a vowel.
    const rng = mulberry32(7);
    const hiss = whiteNoise(300, SR, -63, rng);
    const signal = concat(quiet(500, rng), speech(250), hiss, speech(250), quiet(500, rng));

    // Act
    const { stats } = analyse(signal);

    // Assert: one segment spanning the hiss.
    expect(stats.segments).toBe(1);
    expect(stats.speechMs).toBeGreaterThan(750);
  });

  it('endpoints after the configured silence following speech', () => {
    const rng = mulberry32(8);
    const signal = concat(quiet(300, rng), speech(700), quiet(3000, rng));
    const decision = firstDecision(signal, HANDS_FREE);
    expect(decision?.reason).toBe('endpoint');
    expect(decision?.atMs).toBeGreaterThanOrEqual(1980);
    expect(decision?.atMs).toBeLessThanOrEqual(2060);
  });

  it('gives up with no-speech when nothing is said before the timeout', () => {
    const decision = firstDecision(quiet(5000, mulberry32(9)), HANDS_FREE);
    expect(decision).toEqual({ reason: 'no-speech', atMs: 3000 });
  });

  it('never stops push-to-talk early, only at the maximum duration', () => {
    const rng = mulberry32(10);
    const signal = concat(quiet(300, rng), speech(500), quiet(4000, rng));
    expect(firstDecision(signal, PUSH_TO_TALK)).toBeNull();
    expect(firstDecision(signal, PUSH_TO_TALK, 2000)).toEqual({ reason: 'max-duration', atMs: 2000 });
  });

  it('adapts the noise floor when the room gets louder', () => {
    // Arrange: quiet, then a fan turns on 30 dB louder.
    const rng = mulberry32(11);
    const vad = new Vad(SR);

    // Act
    vad.push(concat(quiet(1000, rng), whiteNoise(7000, SR, -40, rng)));

    // Assert
    expect(vad.noiseFloorDb).toBeGreaterThan(-42);
    expect(vad.inSpeech).toBe(false);
    const decision = firstDecision(concat(quiet(1000, rng), whiteNoise(9000, SR, -40, rng)), HANDS_FREE);
    expect(decision?.reason).toBe('endpoint');
    expect(decision?.atMs).toBeLessThan(7000);
  });

  it('lets the floor fall immediately when the room gets quieter', () => {
    const rng = mulberry32(12);
    const vad = new Vad(SR);
    vad.push(concat(whiteNoise(2000, SR, -45, rng), quiet(200, rng)));
    expect(vad.noiseFloorDb).toBeLessThan(-65);
  });
});

describe('frameFeatures', () => {
  it('measures energy in dBFS and zero-crossing rate, ignoring DC', () => {
    const sine = tone(1000, 20, SR, -20);
    const withDc = sine.map((v) => v + 0.3);
    const f = frameFeatures(withDc);
    expect(f.db).toBeCloseTo(-20, 1);
    expect(f.zcr).toBeCloseTo(2000 / SR, 2);
    expect(frameFeatures(new Float32Array(0)).db).toBe(-100);
  });
});

describe('mergeSegments / powerToDb', () => {
  it('merges segments closer than the gap and keeps the rest', () => {
    const merged = mergeSegments([{ start: 0, end: 5 }, { start: 8, end: 10 }, { start: 30, end: 31 }], 5);
    expect(merged).toEqual([{ start: 0, end: 10 }, { start: 30, end: 31 }]);
  });

  it('clamps silence to the floor value', () => {
    expect(powerToDb(0)).toBe(-100);
    expect(powerToDb(1)).toBe(0);
    expect(powerToDb(1e-30, -90)).toBe(-90);
  });
});
