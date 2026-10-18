/**
 * Opt-in "Hey Leafy" listening: while enabled, the engine keeps the speech-capture microphone
 * stream open (shared with captures, so a summoned command starts instantly) and streams 80 ms
 * frames of 16 kHz audio to main, where a utility process runs the detector. Nothing is sent while
 * Rivertide records a command or speaks (plus a short tail so Leafy's own voice never wakes it);
 * the first frame after any pause is marked `fresh` so the detector starts over. Disabling closes
 * the stream so the macOS mic indicator turns off.
 */
import type { Tap, TapSource } from './audio-hub';
import { WakeFramer } from './dsp/wake-framer';
import { MicError, type OpenedStream } from './mic';
import { describeError, type Reporter } from './report';

export type WakeGate = 'capturing' | 'speaking';

/** After Rivertide stops speaking, keep ignoring the room this long (speaker echo and reverb). */
export const SPEECH_TAIL_MS = 700;

export interface WakeStreams {
  acquire(deviceId: string | null): Promise<OpenedStream>;
  release(stream: MediaStream): void;
}

export interface WakeDeps {
  readonly streams: WakeStreams;
  readonly audio: TapSource;
  readonly report: Reporter;
  readonly now?: () => number;
}

interface Listening {
  readonly deviceId: string | null;
  readonly stream: MediaStream;
  readonly tap: Tap;
  readonly detachTrack: () => void;
}

const HOLDER = 'wake';

export class WakeController {
  private readonly deps: WakeDeps;
  private desired: { readonly enabled: boolean; readonly deviceId: string | null } = { enabled: false, deviceId: null };
  private gates: Readonly<Record<WakeGate, boolean>> = { capturing: false, speaking: false };
  private quietUntil = 0;
  private fresh = true;
  private listening: Listening | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: WakeDeps) {
    this.deps = deps;
  }

  get isListening(): boolean {
    return this.listening !== null;
  }

  get isSuppressed(): boolean {
    return this.gates.capturing || this.gates.speaking || this.now() < this.quietUntil;
  }

  configure(enabled: boolean, deviceId: string | null): Promise<void> {
    this.desired = { enabled, deviceId };
    return this.enqueue(() => this.apply());
  }

  setGate(gate: WakeGate, on: boolean): void {
    if (gate === 'speaking' && this.gates.speaking && !on) this.quietUntil = this.now() + SPEECH_TAIL_MS;
    this.gates = { ...this.gates, [gate]: on };
    if (on) this.fresh = true;
  }

  /** Devices changed: reopen so we follow the chosen (or default) microphone. */
  handleDeviceChange(): Promise<void> {
    if (!this.desired.enabled) return Promise.resolve();
    return this.enqueue(async () => {
      this.close();
      await this.apply();
    });
  }

  dispose(): Promise<void> {
    this.desired = { ...this.desired, enabled: false };
    return this.enqueue(async () => this.close());
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task).catch((error: unknown) => {
      this.deps.report.error('wake', `“Hey Leafy” listening stopped: ${describeError(error)}`);
    });
    this.queue = next;
    return next;
  }

  private async apply(): Promise<void> {
    if (!this.desired.enabled) return this.close();
    if (this.listening?.deviceId === this.desired.deviceId) return;
    this.close();
    try {
      this.listening = await this.open(this.desired.deviceId);
    } catch (error) {
      if (error instanceof MicError) this.deps.report.error('mic', `“Hey Leafy” needs the microphone. ${error.message}`);
      else throw error;
    }
  }

  private async open(deviceId: string | null): Promise<Listening> {
    const { stream } = await this.deps.streams.acquire(deviceId);
    try {
      let framer: WakeFramer | null = null;
      const tap = await this.deps.audio.openTap(stream, HOLDER, (block) => {
        if (framer) this.onBlock(framer, block);
      });
      framer = new WakeFramer(tap.sampleRate);
      this.fresh = true;
      const onEnded = () => void this.enqueue(async () => this.close());
      stream.getAudioTracks().forEach((t) => t.addEventListener('ended', onEnded));
      const detachTrack = () => stream.getAudioTracks().forEach((t) => t.removeEventListener('ended', onEnded));
      return { deviceId, stream, tap, detachTrack };
    } catch (error) {
      this.deps.streams.release(stream);
      throw error;
    }
  }

  private onBlock(framer: WakeFramer, block: Float32Array): void {
    try {
      const frames = framer.push(block); // always consumed, so the resampler never sees a gap
      if (this.isSuppressed) {
        this.fresh = true;
        return;
      }
      for (const frame of frames) {
        this.deps.report.wakeAudio(frame, this.fresh);
        this.fresh = false;
      }
    } catch (error) {
      this.deps.report.error('wake', `“Hey Leafy” listening hit a problem: ${describeError(error)}`);
    }
  }

  private close(): void {
    const listening = this.listening;
    this.listening = null;
    if (!listening) return;
    listening.detachTrack();
    listening.tap.dispose();
    this.deps.streams.release(listening.stream);
  }
}
