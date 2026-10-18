/**
 * Streaming openWakeWord features, one 80 ms frame at a time, matching openWakeWord's own
 * streaming code: the mel model sees the new 1280 samples plus 480 of context (8 new mel frames),
 * the embedding model sees the latest 76 mel frames, and the classifier sees the latest 16
 * embeddings. The ONNX sessions are injected (onnx.ts in the worker, fakes in tests).
 */
import { WAKE_FRAME_SAMPLES } from '../../shared/ipc';

export const FRAME_SAMPLES = WAKE_FRAME_SAMPLES;
export const MEL_CONTEXT_SAMPLES = 480;
export const MEL_BINS = 32;
export const MEL_WINDOW = 76;
export const EMBEDDING_DIM = 96;
export const WINDOW_EMBEDDINGS = 16;

export interface FeatureRunner {
  /** Raw melspectrogram.onnx output for PCM16-valued float samples: frames × 32, row-major. */
  melspectrogram(samples: Float32Array): Promise<Float32Array>;
  /** embedding_model.onnx: 76 × 32 mel frames → 96 values. */
  embed(mel: Float32Array): Promise<Float32Array>;
  /** The "Hey Leafy" classifier: 16 × 96 embeddings → score in [0, 1]. */
  classify(window: Float32Array): Promise<number>;
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** openWakeWord scales the ONNX melspectrogram to match Google's original TF features. */
function scaleMel(raw: Float32Array): Float32Array {
  return raw.map((v) => v / 10 + 2);
}

export class WakeFeatures {
  private readonly runner: FeatureRunner;
  private raw = new Float32Array(0);
  private mel = new Float32Array(MEL_WINDOW * MEL_BINS).fill(1);
  private embeddings: readonly Float32Array[] = [];

  constructor(runner: FeatureRunner) {
    this.runner = runner;
  }

  /** Forget everything (the audio had a gap: the engine paused while capturing or speaking). */
  reset(): void {
    this.raw = new Float32Array(0);
    this.mel = new Float32Array(MEL_WINDOW * MEL_BINS).fill(1);
    this.embeddings = [];
  }

  /** Adds one frame; resolves to the classifier score, or null until 16 embeddings exist. */
  async push(frame: Int16Array): Promise<number | null> {
    if (frame.length !== FRAME_SAMPLES) throw new Error(`Wake word frames must be ${FRAME_SAMPLES} samples, got ${frame.length}.`);
    this.raw = concat(this.raw, Float32Array.from(frame)).slice(-(FRAME_SAMPLES + MEL_CONTEXT_SAMPLES));
    const mel = scaleMel(await this.runner.melspectrogram(this.raw));
    this.mel = concat(this.mel, mel).slice(-MEL_WINDOW * MEL_BINS);
    const embedding = await this.runner.embed(this.mel);
    if (embedding.length !== EMBEDDING_DIM) throw new Error(`The embedding model returned ${embedding.length} values instead of ${EMBEDDING_DIM}.`);
    this.embeddings = [...this.embeddings, embedding].slice(-WINDOW_EMBEDDINGS);
    if (this.embeddings.length < WINDOW_EMBEDDINGS) return null;
    const window = new Float32Array(WINDOW_EMBEDDINGS * EMBEDDING_DIM);
    this.embeddings.forEach((e, i) => window.set(e, i * EMBEDDING_DIM));
    return this.runner.classify(window);
  }
}
