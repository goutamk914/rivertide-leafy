import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureController, buildCapturePayload } from '@renderer/engine/capture-controller';
import type { StartCommand } from '@renderer/engine/commands';
import { EMPTY_STATS } from '@renderer/engine/dsp/capture';
import { MicError, type OpenedStream } from '@renderer/engine/mic';
import { FakeAudio, fakeReporter, fakeStream, settle, type FakeReporter, type FakeStream } from './fakes';
import { concat, mulberry32, vowel, whiteNoise } from './synth';

const SR = 48_000;
const quiet = (ms: number) => whiteNoise(ms, SR, -70, mulberry32(ms));
const speech = (ms: number) => vowel(SR, ms, { levelDb: -22 });

function startCommand(requestId: string, overrides: Partial<StartCommand> = {}): StartCommand {
  return {
    type: 'start',
    requestId,
    deviceId: null,
    endpointing: { enabled: false, endSilenceMs: 1000, noSpeechTimeoutMs: 5000 },
    maxDurationMs: 600_000,
    ...overrides,
  };
}

interface Harness {
  readonly controller: CaptureController;
  readonly report: FakeReporter;
  readonly audio: FakeAudio;
  readonly opened: FakeStream[];
  readonly released: MediaStream[];
  readonly active: boolean[];
  acquireImpl: (deviceId: string | null) => Promise<OpenedStream>;
}

function harness(): Harness {
  const report = fakeReporter();
  const audio = new FakeAudio(SR);
  const h: Harness = {
    report,
    audio,
    opened: [],
    released: [],
    active: [],
    acquireImpl: async () => {
      const s = fakeStream();
      h.opened.push(s);
      return { stream: s.stream, fellBack: false };
    },
    controller: null as unknown as CaptureController,
  };
  return Object.assign(h, {
    controller: new CaptureController({
      streams: { acquire: (id) => h.acquireImpl(id), release: (s) => h.released.push(s) },
      audio,
      report,
      onActiveChange: (a) => h.active.push(a),
      now: () => Date.now(),
    }),
  });
}

describe('CaptureController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Feeds ~21 ms blocks while advancing the clock, as a live microphone would. */
  function feedLive(h: Harness, signal: Float32Array): void {
    for (let i = 0; i < signal.length; i += 1024) {
      h.audio.last.feed(signal.subarray(i, i + 1024));
      vi.advanceTimersByTime(21);
    }
  }

  async function stopAndSettle(h: Harness, requestId: string): Promise<void> {
    const done = h.controller.stop(requestId);
    await vi.advanceTimersByTimeAsync(100);
    await done;
  }

  it('records push-to-talk speech and reports one WAV on stop', async () => {
    // Arrange
    const h = harness();
    await h.controller.start(startCommand('r1'));

    // Act
    feedLive(h, concat(quiet(400), speech(800), quiet(400)));
    await stopAndSettle(h, 'r1');

    // Assert
    expect(h.report.captures).toHaveLength(1);
    const [payload] = h.report.captures;
    expect(payload.requestId).toBe('r1');
    expect(payload.reason).toBe('stopped');
    expect(payload.wav).toBeInstanceOf(Uint8Array);
    expect(payload.stats.segments).toBe(1);
    expect(h.audio.last.flushes).toBe(1);
    expect(h.audio.last.disposed).toBe(true);
    expect(h.released).toHaveLength(1);
    expect(h.active).toEqual([true, false]);
    // 1.6 s of audio at ≤ 30 Hz → about 48 level updates, never more.
    expect(h.report.levels.length).toBeGreaterThan(30);
    expect(h.report.levels.length).toBeLessThanOrEqual(50);
    expect(Math.max(...h.report.levels.map((l) => l.level))).toBeGreaterThan(0.4);
    expect(h.report.levels[h.report.levels.length - 1].level).toBe(0);
  });

  it('reports no-speech without audio when nothing was said', async () => {
    const h = harness();
    await h.controller.start(startCommand('r1'));
    h.audio.last.feed(quiet(1500));
    await stopAndSettle(h, 'r1');
    expect(h.report.captures).toEqual([expect.objectContaining({ requestId: 'r1', reason: 'no-speech', wav: null })]);
  });

  it('stops by itself at the end of speech in hands-free mode', async () => {
    const h = harness();
    await h.controller.start(startCommand('r1', { endpointing: { enabled: true, endSilenceMs: 1000, noSpeechTimeoutMs: 5000 } }));
    h.audio.last.feed(concat(quiet(300), speech(600), quiet(2500)));
    await settle();
    expect(h.report.captures).toEqual([expect.objectContaining({ reason: 'endpoint' })]);
    expect(h.report.captures[0].wav).not.toBeNull();
    // A late stop from main for the same request is ignored.
    await stopAndSettle(h, 'r1');
    expect(h.report.captures).toHaveLength(1);
  });

  it('ignores stop and cancel for stale request ids', async () => {
    const h = harness();
    await h.controller.start(startCommand('r2'));
    await h.controller.cancel('old');
    await stopAndSettle(h, 'older');
    expect(h.report.captures).toHaveLength(0);
    expect(h.controller.activeRequestId).toBe('r2');
  });

  it('cancels without audio', async () => {
    const h = harness();
    await h.controller.start(startCommand('r1'));
    h.audio.last.feed(speech(500));
    await h.controller.cancel('r1');
    expect(h.report.captures).toEqual([{ requestId: 'r1', reason: 'cancelled', wav: null, stats: EMPTY_STATS }]);
  });

  it('cancels the previous capture when a new one starts', async () => {
    const h = harness();
    await h.controller.start(startCommand('a'));
    await h.controller.start(startCommand('b'));
    await settle();
    expect(h.report.captures).toEqual([expect.objectContaining({ requestId: 'a', reason: 'cancelled' })]);
    expect(h.controller.activeRequestId).toBe('b');
  });

  it('handles a stop that arrives while the microphone is still opening', async () => {
    // Arrange: the stream opens only after the stop.
    const h = harness();
    let resolveOpen: (s: OpenedStream) => void = () => undefined;
    const s = fakeStream();
    h.acquireImpl = () => new Promise((resolve) => (resolveOpen = resolve));
    const started = h.controller.start(startCommand('r1'));

    // Act
    await h.controller.stop('r1');
    resolveOpen({ stream: s.stream, fellBack: false });
    await started;

    // Assert: one no-speech report, and the late stream is released, not leaked.
    expect(h.report.captures).toEqual([expect.objectContaining({ requestId: 'r1', reason: 'no-speech', wav: null })]);
    expect(h.released).toEqual([s.stream]);
    expect(h.audio.taps).toHaveLength(0);
  });

  it('reports a clear microphone error when permission is denied', async () => {
    const h = harness();
    h.acquireImpl = () => Promise.reject(new MicError('permission', 'Rivertide isn’t allowed to use the microphone.'));
    await h.controller.start(startCommand('r1'));
    expect(h.report.errors).toEqual([{ scope: 'mic', message: 'Rivertide isn’t allowed to use the microphone.' }]);
    expect(h.report.captures).toEqual([expect.objectContaining({ requestId: 'r1', reason: 'error', wav: null, error: 'Rivertide isn’t allowed to use the microphone.' })]);
    expect(h.controller.isActive).toBe(false);
  });

  it('reports audio setup failures as capture errors and releases the stream', async () => {
    const h = harness();
    h.audio.failWith = new Error('worklet failed');
    await h.controller.start(startCommand('r1'));
    expect(h.report.errors[0].scope).toBe('capture');
    expect(h.report.captures[0]).toMatchObject({ reason: 'error' });
    expect(h.released).toHaveLength(1);
  });

  it('notes the fallback when the chosen microphone is gone', async () => {
    const h = harness();
    h.acquireImpl = async () => ({ stream: fakeStream().stream, fellBack: true });
    await h.controller.start(startCommand('r1', { deviceId: 'usb-mic' }));
    expect(h.report.errors).toEqual([expect.objectContaining({ scope: 'mic' })]);
  });

  it('keeps the words when the microphone is unplugged mid-sentence', async () => {
    const h = harness();
    await h.controller.start(startCommand('r1'));
    h.audio.last.feed(concat(quiet(300), speech(700), quiet(300)));
    h.opened[0].track.end();
    await settle();
    expect(h.report.captures).toHaveLength(1);
    expect(h.report.captures[0]).toMatchObject({ reason: 'error' });
    expect(h.report.captures[0].wav).not.toBeNull();
  });

  it('enforces the maximum duration with a wall-clock safety net', async () => {
    const h = harness();
    await h.controller.start(startCommand('r1', { maxDurationMs: 2000 }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.report.captures).toEqual([expect.objectContaining({ reason: 'no-speech' })]);
  });

  it('cancels the active capture on dispose', async () => {
    const h = harness();
    await h.controller.start(startCommand('r1'));
    await h.controller.dispose();
    await h.controller.dispose();
    expect(h.report.captures).toEqual([expect.objectContaining({ reason: 'cancelled' })]);
  });
});

describe('buildCapturePayload', () => {
  const wav = new Uint8Array(46);
  const outcome = { wav, stats: { ...EMPTY_STATS, segments: 1 }, hasSpeech: true };

  it('passes the WAV through for successful endings', () => {
    expect(buildCapturePayload('r', 'max-duration', outcome)).toEqual({ requestId: 'r', reason: 'max-duration', wav, stats: outcome.stats });
  });

  it('turns speechless endings into no-speech', () => {
    expect(buildCapturePayload('r', 'stopped', { ...outcome, wav: null, hasSpeech: false }).reason).toBe('no-speech');
    expect(buildCapturePayload('r', 'endpoint', null)).toMatchObject({ reason: 'no-speech', wav: null, stats: EMPTY_STATS });
  });

  it('keeps audio on errors and adds a message', () => {
    expect(buildCapturePayload('r', 'error', outcome, 'boom')).toMatchObject({ reason: 'error', wav, error: 'boom' });
    expect(buildCapturePayload('r', 'error', null)).toMatchObject({ reason: 'error', wav: null, error: 'The recording failed.' });
  });
});
