/**
 * Runs speech captures for main. Exactly one `engine:capture` report per requestId, whatever
 * happens (stop, cancel, endpoint, max duration, device loss, errors); stale stop/cancel commands
 * are ignored; a new start cancels the previous capture; nothing is left open by accident.
 */
import type { Tap, TapSource } from './audio-hub';
import type { StartCommand } from './commands';
import { CapturePipeline, EMPTY_STATS, type CaptureOutcome } from './dsp/capture';
import { LevelMeter, SILENT_LEVEL } from './dsp/level';
import { ENGINE, LEVEL } from './dsp/tuning';
import type { VadStopReason } from './dsp/vad';
import { LevelThrottle } from './levels';
import { MicError, type OpenedStream } from './mic';
import { describeError, type CapturePayload, type CaptureReason, type Reporter } from './report';

export type EndReason = 'stopped' | 'cancelled' | 'error' | VadStopReason;

export interface CaptureStreams {
  acquire(deviceId: string | null): Promise<OpenedStream>;
  release(stream: MediaStream): void;
}

export interface CaptureDeps {
  readonly streams: CaptureStreams;
  readonly audio: TapSource;
  readonly report: Reporter;
  /** Told when capturing starts/stops (clap detection pauses meanwhile). */
  readonly onActiveChange: (active: boolean) => void;
  readonly now?: () => number;
}

const FALLBACK_NOTE = 'The chosen microphone is not available, so Rivertide is using the default microphone.';
const DISCONNECTED = 'The microphone was disconnected. Please check it and try again.';

/** Maps how a capture ended (and what it produced) onto the `engine:capture` payload. */
export function buildCapturePayload(requestId: string, reason: EndReason, outcome: CaptureOutcome | null, error?: string): CapturePayload {
  const stats = outcome?.stats ?? EMPTY_STATS;
  if (reason === 'cancelled') return { requestId, reason, wav: null, stats };
  // On errors keep whatever speech was captured: the user's words matter more than the error.
  if (reason === 'error') return { requestId, reason, wav: outcome?.wav ?? null, stats, error: error ?? 'The recording failed.' };
  if (!outcome || !outcome.hasSpeech || !outcome.wav) return { requestId, reason: 'no-speech', wav: null, stats };
  const finalReason: CaptureReason = reason;
  return { requestId, reason: finalReason, wav: outcome.wav, stats };
}

type Phase = 'starting' | 'capturing' | 'finishing' | 'ended';

class CaptureRun {
  readonly requestId: string;
  private readonly command: StartCommand;
  private readonly deps: CaptureDeps;
  private readonly onEnded: (run: CaptureRun) => void;
  private readonly throttle = new LevelThrottle(1000 / LEVEL.maxRateHz);
  private phase: Phase = 'starting';
  private stream: MediaStream | null = null;
  private tap: Tap | null = null;
  private pipeline: CapturePipeline | null = null;
  private meter: LevelMeter | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private detachTrack: (() => void) | null = null;

  constructor(command: StartCommand, deps: CaptureDeps, onEnded: (run: CaptureRun) => void) {
    this.requestId = command.requestId;
    this.command = command;
    this.deps = deps;
    this.onEnded = onEnded;
  }

  async begin(): Promise<void> {
    try {
      const opened = await this.deps.streams.acquire(this.command.deviceId);
      this.stream = opened.stream;
      if (this.isClosing()) return this.releaseResources();
      if (opened.fellBack) this.deps.report.error('mic', FALLBACK_NOTE);
      const tap = await this.deps.audio.openTap(opened.stream, `capture:${this.requestId}`, (s) => this.onBatch(s));
      this.tap = tap;
      if (this.isClosing()) return this.releaseResources();
      this.pipeline = new CapturePipeline({ inputRate: tap.sampleRate, endpointing: this.command.endpointing, maxDurationMs: this.command.maxDurationMs });
      this.meter = new LevelMeter(tap.sampleRate);
      this.detachTrack = watchTrackEnd(opened.stream, () => void this.end('error', DISCONNECTED));
      this.timer = setTimeout(() => void this.end('max-duration'), this.command.maxDurationMs + ENGINE.maxDurationGraceMs);
      this.phase = 'capturing';
    } catch (error) {
      await this.fail(error);
    }
  }

  /** Ends the run once; later calls are no-ops. Never throws. */
  async end(reason: EndReason, error?: string): Promise<void> {
    if (this.isClosing()) return;
    const wasCapturing = this.phase === 'capturing';
    this.phase = 'finishing';
    this.clearWatchers();
    this.onEnded(this);
    try {
      if (wasCapturing && reason === 'stopped') {
        this.tap?.flush();
        await delay(ENGINE.flushWaitMs);
      }
      this.phase = 'ended';
      const outcome = wasCapturing && reason !== 'cancelled' ? (this.pipeline as CapturePipeline).finish() : null;
      this.releaseResources();
      await this.deps.report.capture(buildCapturePayload(this.requestId, wasCapturing ? reason : startingReason(reason), outcome, error));
    } catch (failure) {
      this.phase = 'ended';
      this.releaseResources();
      this.deps.report.error('capture', `The recording could not be finished: ${describeError(failure)}`);
      await this.deps.report.capture(buildCapturePayload(this.requestId, 'error', null, describeError(failure)));
    }
  }

  private onBatch(samples: Float32Array): void {
    if (this.phase !== 'capturing' && this.phase !== 'finishing') return;
    try {
      const decision = (this.pipeline as CapturePipeline).push(samples);
      this.emitLevel(samples);
      if (decision && this.phase === 'capturing') void this.end(decision);
    } catch (error) {
      void this.end('error', `Audio processing failed: ${describeError(error)}`);
    }
  }

  private emitLevel(samples: Float32Array): void {
    const meter = this.meter as LevelMeter;
    meter.push(samples);
    if (this.phase === 'capturing' && this.throttle.shouldEmit(this.now())) this.deps.report.level(meter.read());
  }

  private async fail(error: unknown): Promise<void> {
    if (this.isClosing()) {
      this.releaseResources();
      return;
    }
    // Stream failures arrive as MicError (permission, missing device, …); the rest is audio setup.
    const isMic = error instanceof MicError;
    const message = isMic ? error.message : `Recording could not start: ${describeError(error)}`;
    this.deps.report.error(isMic ? 'mic' : 'capture', message);
    await this.end('error', message);
  }

  private releaseResources(): void {
    this.clearWatchers();
    this.tap?.dispose();
    this.tap = null;
    if (this.stream) this.deps.streams.release(this.stream);
    this.stream = null;
  }

  private clearWatchers(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.detachTrack?.();
    this.detachTrack = null;
  }

  /** Not a getter on purpose: phase changes across awaits, which TS narrowing cannot see. */
  private isClosing(): boolean {
    return this.phase === 'finishing' || this.phase === 'ended';
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

/** Without audio there is nothing to transcribe: a plain stop becomes "no speech". */
function startingReason(reason: EndReason): EndReason {
  return reason === 'stopped' || reason === 'endpoint' || reason === 'max-duration' ? 'no-speech' : reason;
}

function watchTrackEnd(stream: MediaStream, onEnded: () => void): () => void {
  const tracks = stream.getAudioTracks();
  tracks.forEach((t) => t.addEventListener('ended', onEnded));
  return () => tracks.forEach((t) => t.removeEventListener('ended', onEnded));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CaptureController {
  private readonly deps: CaptureDeps;
  private current: CaptureRun | null = null;

  constructor(deps: CaptureDeps) {
    this.deps = deps;
  }

  get isActive(): boolean {
    return this.current !== null;
  }

  get activeRequestId(): string | null {
    return this.current?.requestId ?? null;
  }

  start(command: StartCommand): Promise<void> {
    const previous = this.current;
    const run = new CaptureRun(command, this.deps, (r) => this.onRunEnded(r));
    this.current = run;
    if (previous) void previous.end('cancelled');
    this.deps.onActiveChange(true);
    return run.begin();
  }

  stop(requestId: string): Promise<void> {
    return this.endIfCurrent(requestId, 'stopped');
  }

  cancel(requestId: string): Promise<void> {
    return this.endIfCurrent(requestId, 'cancelled');
  }

  dispose(): Promise<void> {
    return this.current ? this.current.end('cancelled') : Promise.resolve();
  }

  private endIfCurrent(requestId: string, reason: EndReason): Promise<void> {
    const run = this.current;
    return run && run.requestId === requestId ? run.end(reason) : Promise.resolve();
  }

  private onRunEnded(run: CaptureRun): void {
    if (this.current !== run) return;
    this.current = null;
    this.deps.onActiveChange(false);
    this.deps.report.level(SILENT_LEVEL);
  }
}
