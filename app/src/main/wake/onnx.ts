/**
 * onnxruntime-node sessions for the wake-word worker (utility process only). The runtime is a
 * native module loaded at run time: from node_modules in development, from the path main passes
 * in RIVERTIDE_ORT_MODULE when packaged. Every session runs on the CPU with few threads so an
 * idle listener costs almost nothing.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as Ort from 'onnxruntime-node';
import { z } from 'zod';
import { EMBEDDING_DIM, MEL_BINS, MEL_WINDOW, WINDOW_EMBEDDINGS, type FeatureRunner } from './features';
import { MODEL_FILES } from './model-files';
import type { Logits, MoonshineRunner } from './moonshine';

export type OrtModule = typeof Ort;
type Session = Ort.InferenceSession;

const FEATURE_THREADS = 1;
const MOONSHINE_THREADS = 2;
const VocabSchema = z.array(z.string().max(64)).min(1000).max(100_000);

export function loadOrt(modulePath: string | undefined): OrtModule {
  // A native module: resolved at run time, never bundled (see scripts/build-main.mjs).
  return require(modulePath && modulePath.length > 0 ? modulePath : 'onnxruntime-node') as OrtModule;
}

function open(ort: OrtModule, dir: string, file: string, threads: number): Promise<Session> {
  return ort.InferenceSession.create(join(dir, file), {
    executionProviders: ['cpu'],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
  });
}

async function runOne(session: Session, input: Ort.Tensor): Promise<Float32Array> {
  const [inputName] = session.inputNames;
  const [outputName] = session.outputNames;
  if (!inputName || !outputName) throw new Error('A wake word model has no inputs or outputs.');
  const output = await session.run({ [inputName]: input });
  const data = output[outputName]?.data;
  if (!(data instanceof Float32Array)) throw new Error('A wake word model returned an unexpected tensor type.');
  return data;
}

export async function createFeatureRunner(ort: OrtModule, dir: string): Promise<FeatureRunner> {
  const [mel, embedding, classifier] = await Promise.all([
    open(ort, dir, MODEL_FILES.melspectrogram, FEATURE_THREADS),
    open(ort, dir, MODEL_FILES.embedding, FEATURE_THREADS),
    open(ort, dir, MODEL_FILES.classifier, FEATURE_THREADS),
  ]);
  return {
    melspectrogram: (samples) => runOne(mel, new ort.Tensor('float32', samples, [1, samples.length])),
    embed: (frames) => runOne(embedding, new ort.Tensor('float32', frames, [1, MEL_WINDOW, MEL_BINS, 1])),
    classify: async (window) => {
      const out = await runOne(classifier, new ort.Tensor('float32', window, [1, WINDOW_EMBEDDINGS, EMBEDDING_DIM]));
      return out[0] ?? 0;
    },
  };
}

export async function createMoonshineRunner(ort: OrtModule, dir: string): Promise<MoonshineRunner<Ort.Tensor>> {
  const [encoder, decoder] = await Promise.all([
    open(ort, dir, MODEL_FILES.encoder, MOONSHINE_THREADS),
    open(ort, dir, MODEL_FILES.decoder, MOONSHINE_THREADS),
  ]);
  return {
    async encode(audio) {
      const out = await encoder.run({ input_values: new ort.Tensor('float32', audio, [1, audio.length]) });
      const hidden = out['last_hidden_state'];
      if (!hidden) throw new Error('The speech model returned no encoding.');
      return hidden;
    },
    async decode(hidden, rows): Promise<Logits> {
      const batch = rows.length;
      const length = rows[0]?.length ?? 0;
      const ids = BigInt64Array.from(rows.flatMap((row) => row.map((id) => BigInt(id))));
      const [, frames = 0, width = 0] = hidden.dims;
      const states = new Float32Array(batch * frames * width);
      for (let b = 0; b < batch; b += 1) states.set(hidden.data as Float32Array, b * frames * width);
      const out = await decoder.run(
        { input_ids: new ort.Tensor('int64', ids, [batch, length]), encoder_hidden_states: new ort.Tensor('float32', states, [batch, frames, width]) },
        ['logits'],
      );
      const logits = out['logits'];
      if (!logits || !(logits.data instanceof Float32Array)) throw new Error('The speech model returned no logits.');
      return { data: logits.data, batch, length, vocab: logits.dims[2] ?? 0 };
    },
  };
}

export async function readVocab(dir: string): Promise<readonly string[]> {
  return VocabSchema.parse(JSON.parse(await readFile(join(dir, MODEL_FILES.vocab), 'utf8')));
}
