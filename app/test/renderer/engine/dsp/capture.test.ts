import { describe, expect, it } from 'vitest';
import { CapturePipeline, EMPTY_STATS, trimRange, type CaptureConfig } from '@renderer/engine/dsp/capture';
import { concat, mulberry32, vowel, whiteNoise } from '../synth';

const SR = 48_000;
const PTT: CaptureConfig = {
  inputRate: SR,
  endpointing: { enabled: false, endSilenceMs: 2200, noSpeechTimeoutMs: 8000 },
  maxDurationMs: 600_000,
};

function feed(pipeline: CapturePipeline, signal: Float32Array, block = 1024) {
  for (let i = 0; i < signal.length; i += block) {
    const reason = pipeline.push(signal.subarray(i, i + block));
    if (reason) return reason;
  }
  return null;
}

const wavSamples = (wav: Uint8Array) => (wav.length - 44) / 2;

describe('CapturePipeline', () => {
  it('turns 48 kHz speech into a trimmed 16 kHz WAV with stats', () => {
    // Arrange: 1.5 s quiet, 1 s voice, 1.5 s quiet.
    const rng = mulberry32(1);
    const signal = concat(whiteNoise(1500, SR, -70, rng), vowel(SR, 1000, { levelDb: -22 }), whiteNoise(1500, SR, -70, rng));
    const pipeline = new CapturePipeline(PTT);

    // Act
    expect(feed(pipeline, signal)).toBeNull();
    const outcome = pipeline.finish();

    // Assert: 500 ms pre-roll + ~1 s speech + 600 ms post-roll at 16 kHz.
    expect(outcome.hasSpeech).toBe(true);
    expect(outcome.wav).not.toBeNull();
    const seconds = wavSamples(outcome.wav as Uint8Array) / 16_000;
    expect(seconds).toBeGreaterThan(2.0);
    expect(seconds).toBeLessThan(2.2);
    expect(new DataView((outcome.wav as Uint8Array).buffer).getUint32(24, true)).toBe(16_000);
    expect(outcome.stats.durationMs).toBe(4000);
    expect(outcome.stats.segments).toBe(1);
  });

  it('returns no WAV when nothing was said', () => {
    const pipeline = new CapturePipeline(PTT);
    feed(pipeline, whiteNoise(2000, SR, -70, mulberry32(2)));
    const outcome = pipeline.finish();
    expect(outcome).toMatchObject({ wav: null, hasSpeech: false });
    expect(outcome.stats.durationMs).toBe(2000);
  });

  it('asks to stop at the endpoint in hands-free mode', () => {
    const rng = mulberry32(3);
    const pipeline = new CapturePipeline({ ...PTT, endpointing: { enabled: true, endSilenceMs: 1000, noSpeechTimeoutMs: 5000 } });
    const reason = feed(pipeline, concat(whiteNoise(300, SR, -70, rng), vowel(SR, 600), whiteNoise(3000, SR, -70, rng)));
    expect(reason).toBe('endpoint');
    expect(pipeline.elapsedMs).toBeGreaterThan(1800);
    expect(pipeline.elapsedMs).toBeLessThan(2100);
  });

  it('asks to stop at the maximum duration', () => {
    const pipeline = new CapturePipeline({ ...PTT, maxDurationMs: 1000 });
    expect(feed(pipeline, whiteNoise(2000, SR, -70, mulberry32(4)))).toBe('max-duration');
  });

  it('can only be finished once and ignores audio afterwards', () => {
    const pipeline = new CapturePipeline(PTT);
    pipeline.finish();
    expect(pipeline.push(new Float32Array(1024))).toBeNull();
    expect(pipeline.finish()).toEqual({ wav: null, stats: EMPTY_STATS, hasSpeech: false });
  });
});

describe('trimRange', () => {
  it('adds pre-roll and post-roll around the speech, clamped to the capture', () => {
    expect(trimRange([{ startMs: 1000, endMs: 2000 }], 16_000 * 5, 16_000)).toEqual({ start: 8000, end: 41_600 });
    expect(trimRange([{ startMs: 100, endMs: 4900 }], 16_000 * 5, 16_000)).toEqual({ start: 0, end: 80_000 });
    expect(trimRange([], 16_000, 16_000)).toBeNull();
  });
});
