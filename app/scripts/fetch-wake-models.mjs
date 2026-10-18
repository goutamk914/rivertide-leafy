#!/usr/bin/env node
/**
 * Fetches the third-party model files "Hey Leafy" needs into resources/wake-word/, checking each
 * against a pinned SHA-256. Runs at build time only; the app never downloads anything.
 *
 *   melspectrogram.onnx, embedding_model.onnx  openWakeWord v0.5.1 feature models (Apache-2.0;
 *                                             the embedding is Google's speech_embedding)
 *   moonshine-encoder.onnx, moonshine-decoder.onnx, moonshine-vocab.json
 *                                             Moonshine Tiny, int8 (MIT, Useful Sensors)
 *
 * hey_leafy.onnx is Rivertide's own model and is committed (see scripts/wake-word/).
 * Usage: node scripts/fetch-wake-models.mjs [--force]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL_DIR = join(APP_DIR, 'resources', 'wake-word');
const OWW = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1';
const MOONSHINE = 'https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/a6da1241cd305dcd64eab1edbd615f2bb9aabb95';
const TIMEOUT_MS = 120_000;

export const DOWNLOADS = [
  { file: 'melspectrogram.onnx', url: `${OWW}/melspectrogram.onnx`, sha256: 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f' },
  { file: 'embedding_model.onnx', url: `${OWW}/embedding_model.onnx`, sha256: '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f' },
  { file: 'moonshine-encoder.onnx', url: `${MOONSHINE}/onnx/encoder_model_quantized.onnx`, sha256: 'c6fc4b7bc5af75c0591fd157a1f3829b533d18e9769a888fd95a62e470dd4f4a' },
  { file: 'moonshine-decoder.onnx', url: `${MOONSHINE}/onnx/decoder_model_quantized.onnx`, sha256: '2e7db65f157a0c1b7a2ca2e9bf682766de9304664df8e74605838ea75751affa' },
];
const TOKENIZER = { url: `${MOONSHINE}/tokenizer.json`, sha256: '7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f' };
const VOCAB_FILE = 'moonshine-vocab.json';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`${url}: checksum mismatch (expected ${expected}, got ${actual})`);
  return bytes;
}

async function isCurrent(path, expected) {
  return existsSync(path) && sha256(await readFile(path)) === expected;
}

/** Writes atomically so an interrupted build never leaves a half-written model behind. */
async function writeAtomic(path, bytes) {
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
}

/** Moonshine's tokenizer.json → a plain array of token strings indexed by id (all decoding needs). */
export function vocabFromTokenizer(tokenizer) {
  const vocab = tokenizer?.model?.vocab;
  if (!vocab || typeof vocab !== 'object') throw new Error('tokenizer.json has no model.vocab');
  const entries = Object.entries(vocab);
  const out = new Array(Math.max(...entries.map(([, id]) => id)) + 1).fill('');
  for (const [token, id] of entries) out[id] = token;
  return out;
}

export async function fetchWakeModels({ force = false, log = (m) => process.stdout.write(`${m}\n`) } = {}) {
  await mkdir(MODEL_DIR, { recursive: true });
  for (const item of DOWNLOADS) {
    const path = join(MODEL_DIR, item.file);
    if (!force && (await isCurrent(path, item.sha256))) continue;
    log(`fetch-wake-models: downloading ${item.file}`);
    await writeAtomic(path, await download(item.url, item.sha256));
  }
  const vocabPath = join(MODEL_DIR, VOCAB_FILE);
  if (force || !existsSync(vocabPath)) {
    log(`fetch-wake-models: building ${VOCAB_FILE}`);
    const tokenizer = JSON.parse((await download(TOKENIZER.url, TOKENIZER.sha256)).toString('utf8'));
    await writeAtomic(vocabPath, JSON.stringify(vocabFromTokenizer(tokenizer)));
  }
  if (!existsSync(join(MODEL_DIR, 'hey_leafy.onnx'))) log('fetch-wake-models: warning: resources/wake-word/hey_leafy.onnx is missing');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchWakeModels({ force: process.argv.includes('--force') }).catch((error) => {
    process.stderr.write(`fetch-wake-models failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
