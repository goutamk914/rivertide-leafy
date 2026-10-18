/** Minimal fakes for the engine's browser dependencies (MediaStream, worklet taps, reporter). */
import type { AudioLevel } from '@shared/types';
import type { Tap, TapSource } from '@renderer/engine/audio-hub';
import type { CapturePayload, ErrorScope, Reporter, VoiceInfo } from '@renderer/engine/report';

export class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stopped = false;
  private listeners: (() => void)[] = [];

  addEventListener(_type: 'ended', listener: () => void): void {
    this.listeners = [...this.listeners, listener];
  }

  removeEventListener(_type: 'ended', listener: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  stop(): void {
    this.stopped = true;
    this.readyState = 'ended';
  }

  /** The device disappeared. */
  end(): void {
    this.readyState = 'ended';
    this.listeners.forEach((l) => l());
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

export interface FakeStream {
  readonly stream: MediaStream;
  readonly track: FakeTrack;
}

export function fakeStream(): FakeStream {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

export class FakeTap implements Tap {
  readonly sampleRate: number;
  readonly holder: string;
  readonly stream: MediaStream;
  flushes = 0;
  disposed = false;
  private readonly onBatch: (samples: Float32Array) => void;

  constructor(sampleRate: number, holder: string, stream: MediaStream, onBatch: (samples: Float32Array) => void) {
    this.sampleRate = sampleRate;
    this.holder = holder;
    this.stream = stream;
    this.onBatch = onBatch;
  }

  /** Delivers audio as the worklet would, in ~21 ms blocks. */
  feed(signal: Float32Array, block = 1024): void {
    for (let i = 0; i < signal.length && !this.disposed; i += block) this.onBatch(signal.subarray(i, i + block));
  }

  flush(): void {
    this.flushes += 1;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export class FakeAudio implements TapSource {
  readonly sampleRate: number;
  taps: FakeTap[] = [];
  failWith: Error | null = null;

  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate;
  }

  get last(): FakeTap {
    const tap = this.taps[this.taps.length - 1];
    if (!tap) throw new Error('no tap opened');
    return tap;
  }

  async openTap(stream: MediaStream, holder: string, onBatch: (samples: Float32Array) => void): Promise<Tap> {
    if (this.failWith) throw this.failWith;
    const tap = new FakeTap(this.sampleRate, holder, stream, onBatch);
    this.taps = [...this.taps, tap];
    return tap;
  }
}

export interface FakeReporter extends Reporter {
  readonly captures: CapturePayload[];
  readonly errors: { scope: ErrorScope; message: string }[];
  readonly claps: number[];
  readonly levels: AudioLevel[];
  readonly voiceLists: (readonly VoiceInfo[])[];
  readonly wakeFrames: { samples: Int16Array; fresh: boolean }[];
  readyCount: number;
}

export function fakeReporter(): FakeReporter {
  const r: FakeReporter = {
    captures: [],
    errors: [],
    claps: [],
    levels: [],
    voiceLists: [],
    wakeFrames: [],
    readyCount: 0,
    ready: async () => {
      r.readyCount += 1;
    },
    capture: async (payload) => {
      r.captures.push(payload);
    },
    clap: (at) => r.claps.push(at),
    voices: (list) => r.voiceLists.push(list),
    error: (scope, message) => r.errors.push({ scope, message }),
    level: (level) => r.levels.push(level),
    wakeAudio: (samples, fresh) => r.wakeFrames.push({ samples, fresh }),
  };
  return r;
}

/** Lets pending promise callbacks run. */
export async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

export function domError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
