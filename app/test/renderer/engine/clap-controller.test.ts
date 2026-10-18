import { describe, expect, it } from 'vitest';
import { ClapController } from '@renderer/engine/clap-controller';
import { MicError, type OpenedStream } from '@renderer/engine/mic';
import { FakeAudio, fakeReporter, fakeStream, type FakeStream } from './fakes';
import { clap, mulberry32, scene } from './synth';

const SR = 48_000;

function doubleClap(seed = 1): Float32Array {
  const rng = mulberry32(seed);
  return scene(SR, 3000, rng, -75, [1200, 1500].map((atMs) => ({ atMs, signal: clap(SR, rng) })));
}

function harness(openImpl?: () => Promise<OpenedStream>) {
  const report = fakeReporter();
  const audio = new FakeAudio(SR);
  const opened: FakeStream[] = [];
  const devices: (string | null)[] = [];
  const controller = new ClapController({
    openRaw: openImpl ?? (async (deviceId) => {
      devices.push(deviceId);
      const s = fakeStream();
      opened.push(s);
      return { stream: s.stream, fellBack: false };
    }),
    audio,
    report,
    now: () => 42,
  });
  return { controller, report, audio, opened, devices };
}

describe('ClapController', () => {
  it('opens a raw stream when enabled and reports a double clap', async () => {
    const h = harness();
    await h.controller.configure(true, 'medium');
    expect(h.controller.isListening).toBe(true);
    h.audio.last.feed(doubleClap());
    expect(h.report.claps).toEqual([42]);
  });

  it('does not fire while capturing, speaking or while the user is active', async () => {
    const h = harness();
    await h.controller.configure(true, 'medium');
    for (const gate of ['capturing', 'speaking', 'userActive'] as const) {
      h.controller.setGate(gate, true);
      h.audio.last.feed(doubleClap());
      h.controller.setGate(gate, false);
    }
    expect(h.report.claps).toEqual([]);
    expect(h.controller.isSuppressed).toBe(false);
  });

  it('closes the stream (mic indicator off) when disabled', async () => {
    const h = harness();
    await h.controller.configure(true, 'high');
    await h.controller.configure(false, 'high');
    expect(h.controller.isListening).toBe(false);
    expect(h.opened[0].track.stopped).toBe(true);
    expect(h.audio.last.disposed).toBe(true);
  });

  it('does not open twice when enabled twice, and follows the preferred device after a device change', async () => {
    const h = harness();
    await h.controller.configure(true, 'medium');
    await h.controller.configure(true, 'low');
    expect(h.opened).toHaveLength(1);
    h.controller.setPreferredDevice('usb-mic');
    await h.controller.handleDeviceChange();
    expect(h.opened).toHaveLength(2);
    expect(h.opened[0].track.stopped).toBe(true);
    expect(h.devices).toEqual([null, 'usb-mic']);
  });

  it('ignores device changes while disabled', async () => {
    const h = harness();
    await h.controller.handleDeviceChange();
    expect(h.opened).toHaveLength(0);
  });

  it('closes when the microphone disappears', async () => {
    const h = harness();
    await h.controller.configure(true, 'medium');
    h.opened[0].track.end();
    await h.controller.configure(true, 'medium'); // waits for the queued close, then reopens
    expect(h.opened).toHaveLength(2);
  });

  it('reports a microphone error when permission is missing', async () => {
    const h = harness(() => Promise.reject(new MicError('permission', 'Not allowed.')));
    await h.controller.configure(true, 'medium');
    expect(h.controller.isListening).toBe(false);
    expect(h.report.errors).toEqual([{ scope: 'mic', message: 'Clap detection needs the microphone. Not allowed.' }]);
  });

  it('reports other failures under the clap scope and stops the stream it opened', async () => {
    const h = harness();
    h.audio.failWith = new Error('no worklet');
    await h.controller.configure(true, 'medium');
    expect(h.report.errors[0].scope).toBe('clap');
    expect(h.opened[0].track.stopped).toBe(true);
  });

  it('disposes cleanly', async () => {
    const h = harness();
    await h.controller.configure(true, 'medium');
    await h.controller.dispose();
    expect(h.opened[0].track.stopped).toBe(true);
  });
});
