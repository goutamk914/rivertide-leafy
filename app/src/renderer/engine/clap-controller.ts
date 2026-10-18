/**
 * Opt-in double-clap listening on a separate raw microphone stream (no echo cancellation, noise
 * suppression or AGC). The detector keeps learning the room while gated (capturing, speaking,
 * user typing/mousing) but only fires when none of those apply. Disabling closes the stream so
 * the macOS mic indicator turns off.
 */
import type { Tap, TapSource } from './audio-hub';
import { ClapDetector } from './dsp/clap';
import type { ClapSensitivity } from './dsp/tuning';
import { MicError, stopStream, type OpenedStream } from './mic';
import { describeError, type Reporter } from './report';

export type ClapGate = 'capturing' | 'speaking' | 'userActive';

export interface ClapDeps {
  readonly openRaw: (deviceId: string | null) => Promise<OpenedStream>;
  readonly audio: TapSource;
  readonly report: Reporter;
  readonly now?: () => number;
}

interface Listening {
  readonly stream: MediaStream;
  readonly tap: Tap;
  readonly detector: ClapDetector;
  readonly detachTrack: () => void;
}

const HOLDER = 'clap';

export class ClapController {
  private readonly deps: ClapDeps;
  private desired: { readonly enabled: boolean; readonly sensitivity: ClapSensitivity } = { enabled: false, sensitivity: 'medium' };
  private gates: Readonly<Record<ClapGate, boolean>> = { capturing: false, speaking: false, userActive: false };
  private preferredDevice: string | null = null;
  private listening: Listening | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: ClapDeps) {
    this.deps = deps;
  }

  get isListening(): boolean {
    return this.listening !== null;
  }

  get isSuppressed(): boolean {
    return this.gates.capturing || this.gates.speaking || this.gates.userActive;
  }

  configure(enabled: boolean, sensitivity: ClapSensitivity): Promise<void> {
    this.desired = { enabled, sensitivity };
    this.listening?.detector.setSensitivity(sensitivity);
    return this.enqueue(() => this.apply());
  }

  setGate(gate: ClapGate, on: boolean): void {
    this.gates = { ...this.gates, [gate]: on };
  }

  /** Remember the user's microphone for the next time the clap stream opens. */
  setPreferredDevice(deviceId: string | null): void {
    this.preferredDevice = deviceId;
  }

  /** Devices changed: reopen so we follow the current (or default) microphone. */
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

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task).catch((error: unknown) => {
      this.deps.report.error('clap', `Clap detection stopped: ${describeError(error)}`);
    });
    this.queue = next;
    return next;
  }

  private async apply(): Promise<void> {
    if (!this.desired.enabled) return this.close();
    if (this.listening) return;
    try {
      this.listening = await this.open();
    } catch (error) {
      if (error instanceof MicError) this.deps.report.error('mic', `Clap detection needs the microphone. ${error.message}`);
      else throw error;
    }
  }

  private async open(): Promise<Listening> {
    const { stream } = await this.deps.openRaw(this.preferredDevice);
    try {
      let detector: ClapDetector | null = null;
      const tap = await this.deps.audio.openTap(stream, HOLDER, (samples) => {
        if (detector) this.onBatch(detector, samples);
      });
      detector = new ClapDetector({ sampleRate: tap.sampleRate, sensitivity: this.desired.sensitivity });
      const onEnded = () => void this.enqueue(async () => this.close());
      stream.getAudioTracks().forEach((t) => t.addEventListener('ended', onEnded));
      const detachTrack = () => stream.getAudioTracks().forEach((t) => t.removeEventListener('ended', onEnded));
      // If clap detection was turned off meanwhile, the queued apply() that follows closes this.
      return { stream, tap, detector, detachTrack };
    } catch (error) {
      stopStream(stream);
      throw error;
    }
  }

  private onBatch(detector: ClapDetector, samples: Float32Array): void {
    try {
      const detections = detector.process(samples, this.isSuppressed);
      if (detections.length > 0) this.deps.report.clap((this.deps.now ?? Date.now)());
    } catch (error) {
      this.deps.report.error('clap', `Clap detection hit a problem: ${describeError(error)}`);
    }
  }

  private close(): void {
    const listening = this.listening;
    this.listening = null;
    if (!listening) return;
    listening.detachTrack();
    listening.tap.dispose();
    stopStream(listening.stream);
  }
}
