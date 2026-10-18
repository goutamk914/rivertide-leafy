import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_PROCESSING, CaptureStreamCache, MicError, RAW_PROCESSING, audioConstraints, getStreamWithTimeout, isLive, openStream, toMicError,
} from '@renderer/engine/mic';
import { domError, fakeStream, settle } from './fakes';

describe('toMicError', () => {
  it.each([
    ['NotAllowedError', 'permission'],
    ['SecurityError', 'permission'],
    ['NotFoundError', 'missing-device'],
    ['OverconstrainedError', 'missing-device'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['TypeError', 'unknown'],
  ])('maps %s to %s with a plain sentence', (name, kind) => {
    const error = toMicError(domError(name, 'raw detail'));
    expect(error.kind).toBe(kind);
    expect(error.message).toMatch(/microphone/i);
  });

  it('keeps an existing MicError and handles non-errors', () => {
    const original = new MicError('timeout', 'slow');
    expect(toMicError(original)).toBe(original);
    expect(toMicError('weird').kind).toBe('unknown');
    expect(toMicError(domError('Weird', 'details here')).message).toContain('details here');
  });
});

describe('audioConstraints', () => {
  it('requests the exact device with speech processing on', () => {
    expect(audioConstraints('mic-1', CAPTURE_PROCESSING)).toEqual({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 }, deviceId: { exact: 'mic-1' } },
      video: false,
    });
  });

  it('uses the default device and raw audio for clap detection', () => {
    const audio = audioConstraints(null, RAW_PROCESSING).audio as MediaTrackConstraints;
    expect(audio.deviceId).toBeUndefined();
    expect(audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });
});

describe('openStream', () => {
  it('falls back to the default microphone when the chosen one is gone', async () => {
    const s = fakeStream();
    const calls: MediaStreamConstraints[] = [];
    const gum = async (c: MediaStreamConstraints) => {
      calls.push(c);
      if ((c.audio as MediaTrackConstraints).deviceId) throw domError('OverconstrainedError');
      return s.stream;
    };
    await expect(openStream(gum, 'usb', CAPTURE_PROCESSING)).resolves.toEqual({ stream: s.stream, fellBack: true });
    expect(calls).toHaveLength(2);
  });

  it('does not fall back on permission errors', async () => {
    const gum = async () => {
      throw domError('NotAllowedError');
    };
    await expect(openStream(gum, 'usb', CAPTURE_PROCESSING)).rejects.toMatchObject({ kind: 'permission' });
  });
});

describe('getStreamWithTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('times out and stops a stream that arrives too late', async () => {
    // Arrange
    const s = fakeStream();
    let deliver: (stream: MediaStream) => void = () => undefined;
    const pending = getStreamWithTimeout(() => new Promise((resolve) => (deliver = resolve)), {}, 1000);
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' });

    // Act
    await vi.advanceTimersByTimeAsync(1001);
    deliver(s.stream);
    await settle();

    // Assert
    await assertion;
    expect(s.track.stopped).toBe(true);
  });
});

describe('CaptureStreamCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function cache() {
    const opened: ReturnType<typeof fakeStream>[] = [];
    const c = new CaptureStreamCache(async () => {
      const s = fakeStream();
      opened.push(s);
      return { stream: s.stream, fellBack: false };
    }, 5000);
    return { c, opened };
  }

  it('reuses a live stream for the same device and keeps it warm for 5 s', async () => {
    const { c, opened } = cache();
    const a = await c.acquire(null);
    c.release(a.stream);
    await vi.advanceTimersByTimeAsync(4000);
    const b = await c.acquire(null);
    expect(b.stream).toBe(a.stream);
    expect(opened).toHaveLength(1);
    c.release(b.stream);
    await vi.advanceTimersByTimeAsync(5001);
    expect(opened[0].track.stopped).toBe(true);
    expect(c.openCount).toBe(0);
  });

  it('keeps a stream open while any capture still uses it', async () => {
    const { c, opened } = cache();
    const a = await c.acquire(null);
    const b = await c.acquire(null);
    c.release(a.stream);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(opened[0].track.stopped).toBe(false);
    c.release(b.stream);
    await vi.advanceTimersByTimeAsync(5001);
    expect(opened[0].track.stopped).toBe(true);
  });

  it('closes an old device stream as soon as its last user is done', async () => {
    const { c, opened } = cache();
    const a = await c.acquire('mic-a');
    const b = await c.acquire('mic-b');
    c.release(a.stream);
    expect(opened[0].track.stopped).toBe(true);
    expect(opened[1].track.stopped).toBe(false);
    c.stopAll();
    expect(opened[1].track.stopped).toBe(true);
    c.release(b.stream); // releasing an unknown stream is harmless
  });

  it('reopens when the cached stream has died', async () => {
    const { c, opened } = cache();
    const a = await c.acquire(null);
    c.release(a.stream);
    opened[0].track.end();
    expect(isLive(a.stream)).toBe(false);
    const b = await c.acquire(null);
    expect(b.stream).not.toBe(a.stream);
  });
});
