/**
 * Owns the engine's single AudioContext: recreates it when closed, resumes it when suspended or
 * interrupted, loads the capture worklet once per context, and suspends it when nothing (capture,
 * clap stream, cue) has used it for a while so the hidden window costs no CPU at rest.
 */
import { ENGINE } from './dsp/tuning';

export const WORKLET_NAME = 'capture-processor';

/** A running worklet that streams mono Float32 blocks from a MediaStream. */
export interface Tap {
  readonly sampleRate: number;
  /** Asks the worklet to post its partially filled block now. */
  flush(): void;
  /** Disconnects the graph and releases the context hold. Idempotent. */
  dispose(): void;
}

export interface TapSource {
  openTap(stream: MediaStream, holder: string, onBatch: (samples: Float32Array) => void): Promise<Tap>;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class AudioHub implements TapSource {
  private readonly workletUrl: string;
  private readonly createContext: () => AudioContext;
  private readonly onError: (message: string) => void;
  private context: AudioContext | null = null;
  private worklet: { readonly context: AudioContext; readonly ready: Promise<void> } | null = null;
  private holders: ReadonlySet<string> = new Set();
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { workletUrl: string; onError: (message: string) => void; createContext?: () => AudioContext }) {
    this.workletUrl = options.workletUrl;
    this.onError = options.onError;
    this.createContext = options.createContext ?? (() => new AudioContext({ latencyHint: 'interactive' }));
  }

  /** A running context, held for `holder` until `release(holder)`. */
  async acquire(holder: string, needsWorklet = false): Promise<AudioContext> {
    this.clearSuspendTimer();
    this.holders = new Set([...this.holders, holder]);
    try {
      const context = this.currentContext();
      await this.resume(context);
      if (needsWorklet) await this.loadWorklet(context);
      return context;
    } catch (error) {
      this.release(holder);
      throw error;
    }
  }

  release(holder: string): void {
    this.holders = new Set([...this.holders].filter((h) => h !== holder));
    if (this.holders.size > 0 || !this.context) return;
    this.clearSuspendTimer();
    this.suspendTimer = setTimeout(() => this.suspendIdle(), ENGINE.contextIdleSuspendMs);
  }

  async openTap(stream: MediaStream, holder: string, onBatch: (samples: Float32Array) => void): Promise<Tap> {
    const context = await this.acquire(holder, true);
    try {
      return buildTap(context, stream, onBatch, () => this.release(holder));
    } catch (error) {
      this.release(holder);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.clearSuspendTimer();
    const context = this.context;
    this.context = null;
    this.worklet = null;
    this.holders = new Set();
    if (context && context.state !== 'closed') await context.close();
  }

  private currentContext(): AudioContext {
    if (this.context && this.context.state !== 'closed') return this.context;
    const context = this.createContext();
    context.addEventListener('statechange', () => this.onStateChange(context));
    this.context = context;
    this.worklet = null;
    return context;
  }

  private onStateChange(context: AudioContext): void {
    if (context !== this.context) return;
    if (context.state === 'closed') {
      this.context = null;
      this.worklet = null;
      return;
    }
    // The OS can suspend/interrupt audio (device change, sleep); resume if someone still needs it.
    if (context.state !== 'running' && this.holders.size > 0) {
      this.resume(context).catch((error: unknown) => this.onError(`Audio stopped and could not restart: ${messageOf(error)}`));
    }
  }

  private async resume(context: AudioContext): Promise<void> {
    if (context.state === 'running') return;
    await withTimeout(context.resume(), ENGINE.contextResumeTimeoutMs, 'Audio could not start in the background window.');
    if ((context.state as string) !== 'running') throw new Error('Audio could not start in the background window.');
  }

  private loadWorklet(context: AudioContext): Promise<void> {
    if (this.worklet?.context === context) return this.worklet.ready;
    const ready = context.audioWorklet.addModule(this.workletUrl).catch((error: unknown) => {
      this.worklet = null; // allow a retry on the next capture
      throw new Error(`The audio worklet could not load: ${messageOf(error)}`);
    });
    this.worklet = { context, ready };
    return ready;
  }

  private suspendIdle(): void {
    this.suspendTimer = null;
    const context = this.context;
    if (!context || this.holders.size > 0 || context.state !== 'running') return;
    context.suspend().catch((error: unknown) => this.onError(`Audio could not pause: ${messageOf(error)}`));
  }

  private clearSuspendTimer(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }
}

function buildTap(context: AudioContext, stream: MediaStream, onBatch: (samples: Float32Array) => void, onDispose: () => void): Tap {
  const source = new MediaStreamAudioSourceNode(context, { mediaStream: stream });
  const node = new AudioWorkletNode(context, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { batchMs: ENGINE.workletBatchMs },
  });
  // A silent sink keeps the worklet pulled by the render graph without playing the mic back.
  const sink = new GainNode(context, { gain: 0 });
  node.port.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data instanceof Float32Array && event.data.length > 0) onBatch(event.data);
  };
  source.connect(node);
  node.connect(sink);
  sink.connect(context.destination);
  let disposed = false;
  return {
    sampleRate: context.sampleRate,
    flush: () => {
      if (!disposed) node.port.postMessage({ type: 'flush' });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      node.port.postMessage({ type: 'stop' });
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      onDispose();
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
