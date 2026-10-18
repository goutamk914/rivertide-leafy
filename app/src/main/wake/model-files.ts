/**
 * Files the wake word needs, all in one folder: `resources/wake-word` in development and
 * `<app>/Contents/Resources/wake-word` when packaged. `hey_leafy.onnx` is Rivertide's own model;
 * the others are fetched with pinned checksums by scripts/fetch-wake-models.mjs.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const MODEL_FILES = {
  classifier: 'hey_leafy.onnx',
  melspectrogram: 'melspectrogram.onnx',
  embedding: 'embedding_model.onnx',
  encoder: 'moonshine-encoder.onnx',
  decoder: 'moonshine-decoder.onnx',
  vocab: 'moonshine-vocab.json',
} as const;

/** The model folder for this build: `resourcesRoot` is ctx.paths.resources. */
export function wakeModelDir(resourcesRoot: string, isPackaged: boolean): string {
  return isPackaged ? join(resourcesRoot, 'wake-word') : join(resourcesRoot, 'resources', 'wake-word');
}

export function missingModelFiles(dir: string, exists: (path: string) => boolean = existsSync): readonly string[] {
  return Object.values(MODEL_FILES).filter((name) => !exists(join(dir, name)));
}
