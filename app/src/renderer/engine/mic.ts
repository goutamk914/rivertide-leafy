/**
 * Microphone access: constraints, friendly error messages, device fallback, a timeout that never
 * leaks a late stream, and a reference-counted capture stream that stays warm for a few seconds.
 */
import { ENGINE } from './dsp/tuning';

export interface Processing {
  readonly echoCancellation: boolean;
  readonly noiseSuppression: boolean;
  readonly autoGainControl: boolean;
}

/** Speech capture: let the browser clean the signal. */
export const CAPTURE_PROCESSING: Processing = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
/** Clap detection: processing smears transients, so turn it all off. */
export const RAW_PROCESSING: Processing = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

export type MicErrorKind = 'permission' | 'missing-device' | 'busy' | 'timeout' | 'unknown';

export class MicError extends Error {
  readonly kind: MicErrorKind;

  constructor(kind: MicErrorKind, message: string) {
    super(message);
    this.name = 'MicError';
    this.kind = kind;
  }
}

const MESSAGES: Record<MicErrorKind, string> = {
  permission: "Rivertide isn't allowed to use the microphone. Turn it on in System Settings → Privacy & Security → Microphone, then try again.",
  'missing-device': 'No microphone was found. Plug one in, or choose another microphone in Rivertide Settings → Voice.',
  busy: 'The microphone is busy or stopped responding. Close other apps that use it and try again.',
  timeout: "The microphone didn't respond in time. Please try again.",
  unknown: 'The microphone could not be opened.',
};

/** Maps getUserMedia failures to a kind and a plain sentence. */
export function toMicError(error: unknown): MicError {
  if (error instanceof MicError) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  const kind: MicErrorKind = name === 'NotAllowedError' || name === 'SecurityError'
    ? 'permission'
    : name === 'NotFoundError' || name === 'OverconstrainedError'
      ? 'missing-device'
      : name === 'NotReadableError' || name === 'AbortError'
        ? 'busy'
        : 'unknown';
  const detail = kind === 'unknown' && error instanceof Error && error.message ? ` (${error.message})` : '';
  return new MicError(kind, `${MESSAGES[kind]}${detail}`);
}

export function audioConstraints(deviceId: string | null, processing: Processing): MediaStreamConstraints {
  return {
    audio: { ...processing, channelCount: { ideal: 1 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
    video: false,
  };
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export function isLive(stream: MediaStream): boolean {
  const tracks = stream.getAudioTracks();
  return tracks.length > 0 && tracks.every((t) => t.readyState === 'live');
}

export type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/** getUserMedia with a timeout; a stream that arrives after the timeout is stopped at once. */
export function getStreamWithTimeout(getUserMedia: GetUserMedia, constraints: MediaStreamConstraints, timeoutMs: number): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new MicError('timeout', MESSAGES.timeout));
    }, timeoutMs);
    getUserMedia(constraints).then(
      (stream) => {
        if (settled) return stopStream(stream);
        settled = true;
        clearTimeout(timer);
        resolve(stream);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(toMicError(error));
      },
    );
  });
}

export interface OpenedStream {
  readonly stream: MediaStream;
  /** True when the requested device was missing and the default microphone was used instead. */
  readonly fellBack: boolean;
}

/** Opens the requested device, falling back to the default microphone if it is gone. */
export async function openStream(
  getUserMedia: GetUserMedia,
  deviceId: string | null,
  processing: Processing,
  timeoutMs: number = ENGINE.micOpenTimeoutMs,
): Promise<OpenedStream> {
  try {
    return { stream: await getStreamWithTimeout(getUserMedia, audioConstraints(deviceId, processing), timeoutMs), fellBack: false };
  } catch (error) {
    const micError = toMicError(error);
    if (!deviceId || micError.kind !== 'missing-device') throw micError;
    return { stream: await getStreamWithTimeout(getUserMedia, audioConstraints(null, processing), timeoutMs), fellBack: true };
  }
}

/**
 * Speech-capture streams, reference counted per stream so overlapping captures (one finishing,
 * the next starting) share a stream, and the newest stream stays open for `releaseMs` after its
 * last user so the next start is instant. Older streams close as soon as nobody uses them.
 */
export class CaptureStreamCache {
  private readonly open: (deviceId: string | null) => Promise<OpenedStream>;
  private readonly releaseMs: number;
  private entries: readonly { readonly deviceId: string | null; readonly stream: MediaStream; readonly users: number }[] = [];
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(open: (deviceId: string | null) => Promise<OpenedStream>, releaseMs: number = ENGINE.streamReleaseMs) {
    this.open = open;
    this.releaseMs = releaseMs;
  }

  get openCount(): number {
    return this.entries.length;
  }

  /** Serialised so two quick starts never open two streams for the same device. */
  acquire(deviceId: string | null): Promise<OpenedStream> {
    const next = this.pending.then(() => this.acquireNow(deviceId));
    this.pending = next.catch(() => undefined);
    return next;
  }

  release(stream: MediaStream): void {
    const entry = this.entries.find((e) => e.stream === stream);
    if (!entry) return;
    const users = Math.max(0, entry.users - 1);
    this.entries = this.entries.map((e) => (e === entry ? { ...e, users } : e));
    if (users > 0) return;
    const newest = this.entries[this.entries.length - 1];
    if (newest?.stream !== stream || !isLive(stream)) return this.close(stream);
    this.clearTimer();
    this.releaseTimer = setTimeout(() => this.close(stream), this.releaseMs);
  }

  stopAll(): void {
    this.clearTimer();
    this.entries.forEach((e) => stopStream(e.stream));
    this.entries = [];
  }

  private async acquireNow(deviceId: string | null): Promise<OpenedStream> {
    this.clearTimer();
    const reusable = this.entries.find((e) => e.deviceId === deviceId && isLive(e.stream));
    if (reusable) {
      this.entries = this.entries.map((e) => (e === reusable ? { ...e, users: e.users + 1 } : e));
      return { stream: reusable.stream, fellBack: false };
    }
    this.entries.filter((e) => e.users === 0).forEach((e) => this.close(e.stream));
    const opened = await this.open(deviceId);
    this.entries = [...this.entries, { deviceId, stream: opened.stream, users: 1 }];
    return opened;
  }

  private close(stream: MediaStream): void {
    stopStream(stream);
    this.entries = this.entries.filter((e) => e.stream !== stream);
  }

  private clearTimer(): void {
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
  }
}
