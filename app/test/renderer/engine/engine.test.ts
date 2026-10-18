import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '@renderer/engine/engine';
import type { CueName } from '@renderer/engine/commands';
import type { SpeechPort } from '@renderer/engine/tts';
import { FakeAudio, domError, fakeReporter, fakeStream, settle, type FakeStream } from './fakes';
import { clap, concat, mulberry32, scene, vowel, whiteNoise } from './synth';

const SR = 48_000;

function harness(options: { speech?: boolean; micError?: string } = {}) {
  const report = fakeReporter();
  const audio = new FakeAudio(SR);
  const streams: FakeStream[] = [];
  const cues: CueName[] = [];
  const utterances: { onend: (() => void) | null }[] = [];
  const synth = { speaking: false, pending: false, speak: (u: { onend: (() => void) | null }) => utterances.push(u), cancel: () => undefined, getVoices: () => [] };
  const speech: SpeechPort = {
    synth: synth as unknown as SpeechPort['synth'],
    createUtterance: (text) => ({ text, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
  };
  const engine = new Engine({
    report,
    audio,
    speech: options.speech === false ? null : speech,
    cues: { play: async (name) => void cues.push(name) },
    getUserMedia: async () => {
      if (options.micError) throw domError(options.micError);
      const s = fakeStream();
      streams.push(s);
      return s.stream;
    },
  });
  return { engine, report, audio, streams, cues, utterances };
}

const START = { type: 'start', requestId: 'r1', deviceId: null, endpointing: { enabled: false, endSilenceMs: 2200, noSpeechTimeoutMs: 8000 }, maxDurationMs: 600_000 };

describe('Engine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports malformed commands instead of throwing', () => {
    const h = harness();
    expect(() => h.engine.handle({ type: 'start' })).not.toThrow();
    expect(h.report.errors[0].message).toMatch(/invalid engine command/);
    expect(h.report.captures).toHaveLength(0);
  });

  it('still answers a rejected start so main never waits on it', async () => {
    const h = harness();
    h.engine.handle({ ...START, requestId: 'bad', maxDurationMs: -5 });
    await settle();
    expect(h.report.captures).toEqual([expect.objectContaining({ requestId: 'bad', reason: 'error', wav: null })]);
  });

  it('runs a capture from start to stop through the commands', async () => {
    const h = harness();
    h.engine.handle(START);
    await settle(10);
    h.audio.taps.find((t) => t.holder.startsWith('capture'))?.feed(concat(whiteNoise(300, SR, -70, mulberry32(1)), vowel(SR, 600)));
    h.engine.handle({ type: 'stop', requestId: 'r1' });
    await vi.advanceTimersByTimeAsync(100);
    expect(h.report.captures).toEqual([expect.objectContaining({ requestId: 'r1', reason: 'stopped' })]);
  });

  it('reports a denied microphone with the mic scope', async () => {
    const h = harness({ micError: 'NotAllowedError' });
    h.engine.handle(START);
    await settle(10);
    expect(h.report.errors[0]).toMatchObject({ scope: 'mic' });
    expect(h.report.captures[0]).toMatchObject({ reason: 'error' });
  });

  it('pauses clap detection while capturing and while the user is active', async () => {
    // Arrange
    const h = harness();
    h.engine.handle({ type: 'clap', enabled: true, sensitivity: 'medium' });
    await settle(10);
    const clapTap = h.audio.taps.find((t) => t.holder === 'clap');
    const rng = mulberry32(3);
    const claps = () => scene(SR, 3000, rng, -75, [1200, 1500].map((atMs) => ({ atMs, signal: clap(SR, rng) })));

    // Act + Assert: active user → nothing; idle → detected.
    h.engine.handle({ type: 'activity', userActive: true });
    clapTap?.feed(claps());
    expect(h.report.claps).toHaveLength(0);
    h.engine.handle({ type: 'activity', userActive: false });
    clapTap?.feed(claps());
    expect(h.report.claps).toHaveLength(1);

    h.engine.handle(START);
    await settle(10);
    clapTap?.feed(claps());
    expect(h.report.claps).toHaveLength(1);
  });

  it('animates synthetic levels and pauses claps while speaking', async () => {
    const h = harness();
    h.engine.handle({ type: 'speak', text: 'Hello there.', voiceName: null, rate: 1 });
    await vi.advanceTimersByTimeAsync(200);
    expect(h.report.levels.length).toBeGreaterThan(3);
    h.utterances[0].onend?.();
    const count = h.report.levels.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(h.report.levels.length).toBe(count);
    expect(h.report.levels[count - 1].level).toBe(0);
  });

  it('explains when speech is unavailable and plays cues', async () => {
    const h = harness({ speech: false });
    h.engine.handle({ type: 'speak', text: 'Hi', voiceName: null, rate: 1 });
    h.engine.handle({ type: 'stop-speaking' });
    h.engine.handle({ type: 'cue', name: 'success' });
    await settle();
    expect(h.report.errors).toEqual([expect.objectContaining({ scope: 'tts' })]);
    expect(h.cues).toEqual(['success']);
  });

  it('reopens the clap stream on device changes and releases everything on dispose', async () => {
    const h = harness();
    h.engine.handle({ type: 'clap', enabled: true, sensitivity: 'low' });
    await settle(10);
    h.engine.onDeviceChange();
    await settle(10);
    expect(h.streams).toHaveLength(2);
    h.engine.handle(START);
    await settle(10);
    await h.engine.dispose();
    expect(h.streams.every((s) => s.track.stopped)).toBe(true);
    expect(h.report.captures).toEqual([expect.objectContaining({ reason: 'cancelled' })]);
  });
});

describe('Engine — “Hey Leafy”', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('streams wake frames on the shared speech stream and pauses them while capturing', async () => {
    // Arrange
    const h = harness();
    h.engine.handle({ type: 'wake', enabled: true, deviceId: null });
    await settle(10);
    const wakeTap = h.audio.taps.find((t) => t.holder === 'wake');

    // Act: audio while idle, then during a capture
    wakeTap?.feed(whiteNoise(300, SR, -40, mulberry32(3)));
    const idleFrames = h.report.wakeFrames.length;
    h.engine.handle(START);
    await settle(10);
    wakeTap?.feed(whiteNoise(300, SR, -40, mulberry32(4)));

    // Assert
    expect(idleFrames).toBeGreaterThan(0);
    expect(h.report.wakeFrames).toHaveLength(idleFrames);
    expect(h.streams).toHaveLength(1); // the capture reused the wake word's open stream
  });

  it('turns the microphone off when disabled', async () => {
    const h = harness();
    h.engine.handle({ type: 'wake', enabled: true, deviceId: null });
    await settle(10);
    h.engine.handle({ type: 'wake', enabled: false, deviceId: null });
    await settle(10);
    vi.advanceTimersByTime(10_000); // past the warm-stream grace period
    expect(h.audio.taps.find((t) => t.holder === 'wake')?.disposed).toBe(true);
    expect(h.streams.every((s) => s.track.stopped)).toBe(true);
  });
});
