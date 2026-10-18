/**
 * Moonshine Tiny decoding for the wake-word check: greedy transcription of the ring buffer, then
 * one batched forced pass that scores every wake-phrase candidate. The ONNX sessions are injected
 * (onnx.ts in the wake worker, fakes in tests); this file is plain arithmetic.
 */
import { BOS_TOKEN, EOS_TOKEN, MAX_TRANSCRIPT_TOKENS, candidateSequences, decide, type Verdict } from './verify';

/** Decoder output for `batch` rows of `length` positions over `vocab` tokens (row-major). */
export interface Logits {
  readonly data: Float32Array;
  readonly batch: number;
  readonly length: number;
  readonly vocab: number;
}

export interface MoonshineRunner<Hidden> {
  encode(audio: Float32Array): Promise<Hidden>;
  /** Logits for equally long token rows (the caller right-pads with EOS; the decoder is causal). */
  decode(hidden: Hidden, rows: readonly (readonly number[])[]): Promise<Logits>;
}

/** Quiet rooms and loud ones should look alike to the model. */
const TARGET_PEAK = 0.5;
const SILENCE_PEAK = 1e-4;
const FIRST_REAL_TOKEN = 3; // 0–2 are <unk>, <s>, </s>
const BYTE_TOKEN = /^<0x([0-9A-F]{2})>$/;

export function normalizePeak(audio: Float32Array): Float32Array {
  let peak = 0;
  for (const v of audio) peak = Math.max(peak, Math.abs(v));
  if (peak < SILENCE_PEAK) return audio;
  const gain = TARGET_PEAK / peak;
  return audio.map((v) => v * gain);
}

/** log softmax(logits[row, position])[token]. */
export function logProb(logits: Logits, row: number, position: number, token: number): number {
  const start = (row * logits.length + position) * logits.vocab;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = start; i < start + logits.vocab; i += 1) max = Math.max(max, logits.data[i] ?? max);
  let sum = 0;
  for (let i = start; i < start + logits.vocab; i += 1) sum += Math.exp((logits.data[i] ?? max) - max);
  return (logits.data[start + token] ?? Number.NEGATIVE_INFINITY) - max - Math.log(sum);
}

export function argmaxAt(logits: Logits, row: number, position: number): number {
  const start = (row * logits.length + position) * logits.vocab;
  let best = 0;
  for (let i = 1; i < logits.vocab; i += 1) if ((logits.data[start + i] ?? 0) > (logits.data[start + best] ?? 0)) best = i;
  return best;
}

/** SentencePiece-style detokenization: "▁" is a space, <0xNN> tokens are UTF-8 bytes. */
export function detokenize(vocab: readonly string[], ids: readonly number[]): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const id of ids) {
    if (id < FIRST_REAL_TOKEN) continue;
    const piece = vocab[id] ?? '';
    const byte = BYTE_TOKEN.exec(piece);
    if (byte) bytes.push(Number.parseInt(byte[1] ?? '0', 16));
    else bytes.push(...encoder.encode(piece.replaceAll('▁', ' ')));
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).trim();
}

export async function greedy<H>(runner: MoonshineRunner<H>, hidden: H): Promise<{ readonly tokens: number[]; readonly logProb: number }> {
  let tokens: number[] = [];
  let total = 0;
  for (let step = 0; step < MAX_TRANSCRIPT_TOKENS; step += 1) {
    const logits = await runner.decode(hidden, [[BOS_TOKEN, ...tokens]]);
    const position = logits.length - 1;
    const next = argmaxAt(logits, 0, position);
    total += logProb(logits, 0, position, next);
    if (next === EOS_TOKEN) return { tokens, logProb: total };
    tokens = [...tokens, next];
  }
  return { tokens, logProb: total };
}

/** Log-probability of each sequence followed by EOS, in one right-padded batch. */
export async function scoreSequences<H>(runner: MoonshineRunner<H>, hidden: H, sequences: readonly (readonly number[])[]): Promise<number[]> {
  const width = Math.max(...sequences.map((s) => s.length)) + 1;
  const rows = sequences.map((s) => [BOS_TOKEN, ...s, ...new Array<number>(width - s.length - 1).fill(EOS_TOKEN)]);
  const logits = await runner.decode(hidden, rows);
  return sequences.map((sequence, row) => [...sequence, EOS_TOKEN].reduce((sum, token, i) => sum + logProb(logits, row, i, token), 0));
}

/** Transcribes `audio` (16 kHz, [-1, 1]) and decides whether it says "Hey Leafy". */
export async function verifyAudio<H>(runner: MoonshineRunner<H>, vocab: readonly string[], audio: Float32Array, margin: number): Promise<Verdict> {
  const hidden = await runner.encode(normalizePeak(audio));
  const heard = await greedy(runner, hidden);
  const scores = await scoreSequences(runner, hidden, candidateSequences(heard.tokens));
  return decide(detokenize(vocab, heard.tokens), heard.logProb, scores, margin);
}
