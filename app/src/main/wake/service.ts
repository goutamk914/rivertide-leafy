/**
 * `createWakeWordService(ctx, deps)` — "Hey Leafy" (ARCHITECTURE §3.13). While the setting is on,
 * a utility process runs the detector and the engine streams 16 kHz frames to it through main.
 * A confirmed detection only summons Leafy (`ctx.voice.onWake`), exactly like a double clap: it
 * never runs an action by itself. Turning the setting off stops the microphone and the process.
 */
import type { Settings } from '../../shared/settings';
import type { AppContext } from '../services';
import { WorkerEventSchema, type WorkerEvent, type WorkerRequest } from './protocol';

/** Crashes tolerated within RESTART_WINDOW_MS before giving up until the user retries. */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 60_000;
export const RESTART_DELAY_MS = 1000;

export const MISSING_FILES_MESSAGE = '“Hey Leafy” can’t start because some of its files are missing. Reinstalling Rivertide should fix this.';
export const UNSUPPORTED_MESSAGE = '“Hey Leafy” needs a Mac with Apple silicon. A double clap or your voice shortcut still calls Leafy.';
export const GAVE_UP_MESSAGE = '“Hey Leafy” stopped working. Turn it off and on again in Settings → Leafy to try again.';

/** The utility process, as far as this service needs it (Electron's UtilityProcess in the app). */
export interface WakeChild {
  postMessage(message: WorkerRequest): void;
  kill(): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
}

export interface WakeWordDeps {
  readonly fork: () => WakeChild;
  readonly modelDir: string;
  readonly missingFiles: () => readonly string[];
  /** False where the onnxruntime native module has no build (Intel Macs). */
  readonly isSupported: () => boolean;
  readonly now?: () => number;
  readonly schedule?: (task: () => void, ms: number) => void;
}

export interface WakeWordService {
  start(): void;
  stop(): void;
  /** One 80 ms frame of 16 kHz audio from the engine; dropped unless the listener is ready. */
  pushAudio(samples: Int16Array, fresh: boolean): void;
}

type WakeSettings = Settings['wakeWord'];

export function createWakeWordService(ctx: AppContext, deps: WakeWordDeps): WakeWordService {
  const log = ctx.logger.child('wake');
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((task: () => void, ms: number) => void setTimeout(task, ms));
  let wanted: WakeSettings = { enabled: false, sensitivity: 'medium' };
  let child: WakeChild | null = null;
  let ready = false;
  let crashes: readonly number[] = [];
  let unsubscribe: (() => void) | null = null;

  const toast = (message: string) => ctx.bus.emit('toast', { kind: 'error', message });
  const microphone = () => ctx.settings.get().voice.microphoneId;
  let device = microphone();
  const engine = (enabled: boolean) => ctx.windows.engine.send({ type: 'wake', enabled, deviceId: device });

  function launch(): void {
    if (!deps.isSupported()) {
      log.warn('wake word is not supported on this computer', { platform: ctx.platform, arch: process.arch });
      toast(UNSUPPORTED_MESSAGE);
      return;
    }
    const missing = deps.missingFiles();
    if (missing.length > 0) {
      log.error('wake word files are missing', { missing });
      toast(MISSING_FILES_MESSAGE);
      return;
    }
    const current = deps.fork();
    child = current;
    ready = false;
    current.onMessage((raw) => { if (child === current) receive(raw); });
    current.onExit((code) => { if (child === current) exited(code); });
    current.postMessage({ type: 'start', modelDir: deps.modelDir, sensitivity: wanted.sensitivity });
    log.info('wake word listener starting', { sensitivity: wanted.sensitivity });
  }

  /** Stops the microphone stream first, then the process (its exit is then ignored). */
  function halt(): void {
    const current = child;
    child = null;
    ready = false;
    engine(false);
    current?.kill();
  }

  function sync(next: WakeSettings): void {
    const previous = wanted;
    wanted = next;
    if (!next.enabled) {
      if (child) {
        halt();
        log.info('wake word listener stopped');
      }
      return;
    }
    if (!child) {
      crashes = [];
      launch();
      return;
    }
    if (previous.sensitivity !== next.sensitivity) child.postMessage({ type: 'sensitivity', sensitivity: next.sensitivity });
    if (ready && device !== microphone()) {
      device = microphone();
      engine(true); // follow the microphone chosen in Settings → Voice
    }
  }

  function receive(raw: unknown): void {
    const parsed = WorkerEventSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn('ignored an invalid message from the wake word listener');
      return;
    }
    handle(parsed.data);
  }

  function handle(event: WorkerEvent): void {
    switch (event.type) {
      case 'ready':
        ready = true;
        device = microphone();
        engine(true);
        log.info('wake word listener ready');
        return;
      case 'detected':
        log.info('heard “Hey Leafy”', { score: event.score, margin: event.margin });
        ctx.voice.onWake(now());
        return;
      case 'rejected':
        log.debug('wake word candidate rejected by the transcription check', { score: event.score, margin: event.margin });
        return;
      case 'error':
        log.warn('wake word listener reported a problem', { message: event.message, fatal: event.fatal });
        if (!event.fatal) return;
        halt();
        toast(`“Hey Leafy” stopped. ${event.message}`);
    }
  }

  function exited(code: number): void {
    child = null;
    ready = false;
    engine(false);
    if (!wanted.enabled) return;
    const at = now();
    crashes = [...crashes.filter((t) => at - t < RESTART_WINDOW_MS), at];
    log.warn('wake word listener exited unexpectedly', { code, recentCrashes: crashes.length });
    if (crashes.length > MAX_RESTARTS) {
      toast(GAVE_UP_MESSAGE);
      return;
    }
    schedule(() => { if (wanted.enabled && !child) launch(); }, RESTART_DELAY_MS);
  }

  return {
    start() {
      unsubscribe = ctx.bus.on('settings:changed', (settings) => sync(settings.wakeWord));
      sync(ctx.settings.get().wakeWord);
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      wanted = { ...wanted, enabled: false };
      if (child) halt();
    },
    pushAudio(samples, fresh) {
      if (child && ready) child.postMessage({ type: 'audio', samples, fresh });
    },
  };
}
