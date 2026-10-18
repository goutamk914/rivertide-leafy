/**
 * The engine: validates `engine:command` payloads, routes them to capture / clap / TTS / cues,
 * and keeps the cross-cutting gates in one place (clap detection pauses while capturing or
 * speaking; the synthetic waveform runs only while speaking and not capturing).
 * Handlers never throw: every failure is reported to main as `engine:error`.
 */
import type { EngineCommand } from '@shared/ipc';
import type { TapSource } from './audio-hub';
import { CaptureController } from './capture-controller';
import { ClapController } from './clap-controller';
import { parseCommand, rejectedStartId, type CueName } from './commands';
import { EMPTY_STATS } from './dsp/capture';
import { SyntheticLevelLoop } from './levels';
import { CAPTURE_PROCESSING, CaptureStreamCache, RAW_PROCESSING, openStream, type GetUserMedia } from './mic';
import { describeError, type ErrorScope, type Reporter } from './report';
import { Speaker, type SpeechPort } from './tts';
import { WakeController } from './wake-controller';

export interface EngineEnv {
  readonly report: Reporter;
  readonly getUserMedia: GetUserMedia;
  readonly audio: TapSource;
  /** Null when speechSynthesis is unavailable. */
  readonly speech: SpeechPort | null;
  readonly cues: { play(name: CueName): Promise<void> };
}

const NO_SPEECH_ENGINE = 'Spoken answers are not available on this computer, so Leafy will show them as text.';

function scopeOf(command: EngineCommand): ErrorScope {
  switch (command.type) {
    case 'clap':
    case 'activity':
      return 'clap';
    case 'wake':
      return 'wake';
    case 'speak':
    case 'stop-speaking':
    case 'cue':
      return 'tts';
    default:
      return 'capture';
  }
}

export class Engine {
  private readonly report: Reporter;
  private readonly streams: CaptureStreamCache;
  private readonly capture: CaptureController;
  private readonly clap: ClapController;
  private readonly wake: WakeController;
  private readonly speaker: Speaker | null;
  private readonly cues: EngineEnv['cues'];
  private readonly levels: SyntheticLevelLoop;
  private capturing = false;
  private speaking = false;

  constructor(env: EngineEnv) {
    this.report = env.report;
    this.cues = env.cues;
    this.levels = new SyntheticLevelLoop(env.report);
    this.streams = new CaptureStreamCache((deviceId) => openStream(env.getUserMedia, deviceId, CAPTURE_PROCESSING));
    this.capture = new CaptureController({
      streams: this.streams,
      audio: env.audio,
      report: env.report,
      onActiveChange: (active) => this.onCapturing(active),
    });
    this.clap = new ClapController({
      openRaw: (deviceId) => openStream(env.getUserMedia, deviceId, RAW_PROCESSING),
      audio: env.audio,
      report: env.report,
    });
    this.wake = new WakeController({ streams: this.streams, audio: env.audio, report: env.report });
    this.speaker = env.speech ? new Speaker(env.speech, env.report, (speaking) => this.onSpeaking(speaking)) : null;
  }

  /** Entry point for `engine:command`. Never throws. */
  handle(raw: unknown): void {
    const parsed = parseCommand(raw);
    if (!parsed.ok) {
      this.report.error('capture', parsed.message);
      const requestId = rejectedStartId(raw);
      if (requestId) void this.report.capture({ requestId, reason: 'error', wav: null, stats: EMPTY_STATS, error: parsed.message });
      return;
    }
    try {
      this.dispatch(parsed.command);
    } catch (error) {
      this.report.error(scopeOf(parsed.command), describeError(error));
    }
  }

  /** Microphones were plugged in or removed. */
  onDeviceChange(): void {
    this.track('clap', this.clap.handleDeviceChange());
    this.track('wake', this.wake.handleDeviceChange());
  }

  async dispose(): Promise<void> {
    this.speaker?.stop();
    this.levels.stop();
    await Promise.allSettled([this.capture.dispose(), this.clap.dispose(), this.wake.dispose()]);
    this.streams.stopAll();
  }

  private dispatch(command: EngineCommand): void {
    switch (command.type) {
      case 'start':
        this.clap.setPreferredDevice(command.deviceId);
        return this.track('capture', this.capture.start(command));
      case 'stop':
        return this.track('capture', this.capture.stop(command.requestId));
      case 'cancel':
        return this.track('capture', this.capture.cancel(command.requestId));
      case 'clap':
        return this.track('clap', this.clap.configure(command.enabled, command.sensitivity));
      case 'wake':
        return this.track('wake', this.wake.configure(command.enabled, command.deviceId));
      case 'activity':
        return this.clap.setGate('userActive', command.userActive);
      case 'speak':
        if (!this.speaker) return this.report.error('tts', NO_SPEECH_ENGINE);
        return this.speaker.speak(command.text, command.voiceName, command.rate);
      case 'stop-speaking':
        return this.speaker?.stop();
      case 'cue':
        return this.track('tts', this.cues.play(command.name));
    }
  }

  private track(scope: ErrorScope, task: Promise<void>): void {
    task.catch((error: unknown) => this.report.error(scope, describeError(error)));
  }

  private onCapturing(active: boolean): void {
    this.capturing = active;
    this.clap.setGate('capturing', active);
    this.wake.setGate('capturing', active);
    this.syncSyntheticLevels();
  }

  private onSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    this.clap.setGate('speaking', speaking);
    this.wake.setGate('speaking', speaking);
    this.syncSyntheticLevels();
  }

  private syncSyntheticLevels(): void {
    if (this.speaking && !this.capturing) this.levels.start();
    else this.levels.stop();
  }
}
