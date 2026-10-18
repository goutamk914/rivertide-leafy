import { describe, expect, it } from 'vitest';
import { WakeFramer } from '@renderer/engine/dsp/wake-framer';
import { MicError, type OpenedStream } from '@renderer/engine/mic';
import { SPEECH_TAIL_MS, WakeController } from '@renderer/engine/wake-controller';
import { FakeAudio, fakeReporter, fakeStream, settle, type FakeStream } from './fakes';

const SR = 48_000;
const FRAME = 1280;

function tone(seconds: number, amplitude = 0.5, hz = 440): Float32Array {
  return Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / SR));
}

describe('WakeFramer', () => {
  it('turns 48 kHz blocks into 80 ms frames of 16 kHz PCM16', () => {
    // Arrange
    const framer = new WakeFramer(SR);
    const signal = tone(1);

    // Act
    const frames = [];
    for (let i = 0; i < signal.length; i += 960) frames.push(...framer.push(signal.subarray(i, i + 960)));

    // Assert: 1 s at 16 kHz is 12.5 frames; the resampler may hold back a few samples of lookahead
    expect(frames.length).toBeGreaterThanOrEqual(11);
    expect(frames.length).toBeLessThanOrEqual(12);
    expect(frames.every((f) => f instanceof Int16Array && f.length === FRAME)).toBe(true);
    const peak = Math.max(...frames.slice(2).flatMap((f) => Array.from(f, Math.abs)));
    expect(peak / 32767).toBeCloseTo(0.5, 1);
  });

  it('returns nothing until a whole frame is ready', () => {
    expect(new WakeFramer(SR).push(new Float32Array(100))).toEqual([]);
  });
});

function harness(acquireImpl?: (deviceId: string | null) => Promise<OpenedStream>) {
  const report = fakeReporter();
  const audio = new FakeAudio(SR);
  const opened: (FakeStream & { deviceId: string | null })[] = [];
  const released: MediaStream[] = [];
  let clock = 1_000;
  const controller = new WakeController({
    streams: {
      acquire: acquireImpl ?? (async (deviceId) => {
        const s = { ...fakeStream(), deviceId };
        opened.push(s);
        return { stream: s.stream, fellBack: false };
      }),
      release: (stream) => { released.push(stream); },
    },
    audio,
    report,
    now: () => clock,
  });
  const advance = (ms: number) => { clock += ms; };
  return { controller, report, audio, opened, released, advance };
}

describe('WakeController', () => {
  it('opens the shared speech stream when enabled and streams fresh-marked frames', async () => {
    // Arrange
    const h = harness();

    // Act
    await h.controller.configure(true, 'usb-mic');
    h.audio.last.feed(tone(0.5));

    // Assert
    expect(h.controller.isListening).toBe(true);
    expect(h.opened.map((s) => s.deviceId)).toEqual(['usb-mic']);
    expect(h.audio.last.holder).toBe('wake');
    expect(h.report.wakeFrames.length).toBeGreaterThan(4);
    expect(h.report.wakeFrames.map((f) => f.fresh)).toEqual([true, ...new Array(h.report.wakeFrames.length - 1).fill(false)]);
  });

  it('sends nothing while recording a command, then starts fresh', async () => {
    const h = harness();
    await h.controller.configure(true, null);
    h.controller.setGate('capturing', true);
    h.audio.last.feed(tone(0.5));
    expect(h.report.wakeFrames).toEqual([]);
    h.controller.setGate('capturing', false);
    h.audio.last.feed(tone(0.2));
    expect(h.report.wakeFrames[0]?.fresh).toBe(true);
  });

  it('ignores the room while Leafy speaks and for a short tail afterwards', async () => {
    // Arrange
    const h = harness();
    await h.controller.configure(true, null);

    // Act + Assert: speaking
    h.controller.setGate('speaking', true);
    h.audio.last.feed(tone(0.3));
    expect(h.report.wakeFrames).toEqual([]);

    // Speech ended, still inside the tail
    h.controller.setGate('speaking', false);
    h.advance(SPEECH_TAIL_MS - 1);
    expect(h.controller.isSuppressed).toBe(true);
    h.audio.last.feed(tone(0.3));
    expect(h.report.wakeFrames).toEqual([]);

    // Tail over
    h.advance(2);
    h.audio.last.feed(tone(0.3));
    expect(h.report.wakeFrames.length).toBeGreaterThan(0);
    expect(h.report.wakeFrames[0]?.fresh).toBe(true);
  });

  it('closes the tap and gives the stream back when disabled', async () => {
    const h = harness();
    await h.controller.configure(true, null);
    const tap = h.audio.last;
    await h.controller.configure(false, null);
    expect(h.controller.isListening).toBe(false);
    expect(tap.disposed).toBe(true);
    expect(h.released).toEqual([h.opened[0]?.stream]);
  });

  it('switches microphones when the chosen device changes', async () => {
    const h = harness();
    await h.controller.configure(true, null);
    await h.controller.configure(true, 'usb-mic');
    expect(h.opened.map((s) => s.deviceId)).toEqual([null, 'usb-mic']);
    expect(h.released).toEqual([h.opened[0]?.stream]);
  });

  it('does not reopen for the same device', async () => {
    const h = harness();
    await h.controller.configure(true, null);
    await h.controller.configure(true, null);
    expect(h.opened).toHaveLength(1);
  });

  it('explains a microphone problem in plain words', async () => {
    const h = harness(async () => { throw new MicError('permission', 'Turn it on in System Settings.'); });
    await h.controller.configure(true, null);
    expect(h.controller.isListening).toBe(false);
    expect(h.report.errors).toEqual([{ scope: 'mic', message: '“Hey Leafy” needs the microphone. Turn it on in System Settings.' }]);
  });

  it('stops listening when the microphone goes away', async () => {
    const h = harness();
    await h.controller.configure(true, null);
    h.opened[0]?.track.end();
    await settle();
    expect(h.controller.isListening).toBe(false);
  });

  it('releases everything on dispose', async () => {
    const h = harness();
    await h.controller.configure(true, null);
    await h.controller.dispose();
    expect(h.controller.isListening).toBe(false);
    expect(h.released).toHaveLength(1);
  });
});
