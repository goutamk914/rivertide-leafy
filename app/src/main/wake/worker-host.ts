/**
 * Message handling inside the wake-word utility process: validates requests, loads the models on
 * `start`, and runs frames through the detector strictly in order. If the worker falls behind
 * (a busy computer), old frames are dropped rather than queued forever, and the next frame starts
 * fresh. Model loading is injected so this is testable without onnxruntime.
 */
import { WakeDetector } from './detector';
import { WakeFeatures, type FeatureRunner } from './features';
import type { WakeSensitivity } from './gate';
import { verifyAudio, type MoonshineRunner } from './moonshine';
import { WorkerRequestSchema, type WorkerEvent, type WorkerRequest } from './protocol';

/** ~4 s of audio waiting: beyond this, frames are dropped. */
export const MAX_PENDING_FRAMES = 50;

export interface LoadedModels {
  readonly features: FeatureRunner;
  readonly moonshine: MoonshineRunner<unknown>;
  readonly vocab: readonly string[];
}

export interface WorkerHostDeps {
  readonly load: (modelDir: string) => Promise<LoadedModels>;
  readonly emit: (event: WorkerEvent) => void;
}

export interface WorkerHost {
  onMessage(data: unknown): void;
  /** Resolves when everything received so far has been handled (tests). */
  idle(): Promise<void>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500);

export function createWorkerHost(deps: WorkerHostDeps): WorkerHost {
  let detector: WakeDetector | null = null;
  let pending = 0;
  let dropped = false;
  let chain: Promise<void> = Promise.resolve();

  async function start(modelDir: string, sensitivity: WakeSensitivity): Promise<void> {
    try {
      const models = await deps.load(modelDir);
      const features = new WakeFeatures(models.features);
      detector = new WakeDetector({
        features,
        verify: (audio, margin) => verifyAudio(models.moonshine, models.vocab, audio, margin),
        emit: deps.emit,
      }, sensitivity);
      deps.emit({ type: 'ready' });
    } catch (error) {
      deps.emit({ type: 'error', message: `The wake word models could not load: ${messageOf(error)}`, fatal: true });
    }
  }

  async function audio(request: Extract<WorkerRequest, { type: 'audio' }>): Promise<void> {
    if (!detector) return;
    const fresh = request.fresh || dropped;
    dropped = false;
    await detector.push(request.samples, fresh);
  }

  function enqueue(task: () => Promise<void>): void {
    chain = chain.then(task).catch((error: unknown) => {
      deps.emit({ type: 'error', message: `Wake word listening hit a problem: ${messageOf(error)}`, fatal: false });
    });
  }

  return {
    onMessage(data) {
      const parsed = WorkerRequestSchema.safeParse(data);
      if (!parsed.success) {
        deps.emit({ type: 'error', message: 'The wake word listener received a message it did not understand.', fatal: false });
        return;
      }
      const request = parsed.data;
      if (request.type === 'start') return enqueue(() => start(request.modelDir, request.sensitivity));
      if (request.type === 'sensitivity') return enqueue(async () => detector?.setSensitivity(request.sensitivity));
      if (pending >= MAX_PENDING_FRAMES) {
        dropped = true;
        return;
      }
      pending += 1;
      enqueue(() => audio(request).finally(() => { pending -= 1; }));
    },
    idle: () => chain,
  };
}
