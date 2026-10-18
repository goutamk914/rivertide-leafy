import { describe, expect, it, vi } from 'vitest';
import { AudioRing, RING_SAMPLES, WakeDetector } from '../../../src/main/wake/detector';
import { EMBEDDING_DIM, FRAME_SAMPLES, MEL_BINS, MEL_CONTEXT_SAMPLES, MEL_WINDOW, WakeFeatures, WINDOW_EMBEDDINGS, type FeatureRunner } from '../../../src/main/wake/features';
import { COOLDOWN_FRAMES, WAKE_THRESHOLDS } from '../../../src/main/wake/gate';
import { detokenize, greedy, logProb, normalizePeak, scoreSequences, verifyAudio, type Logits, type MoonshineRunner } from '../../../src/main/wake/moonshine';
import type { WorkerEvent } from '../../../src/main/wake/protocol';
import { EOS_TOKEN, MAX_TRANSCRIPT_TOKENS, VERIFY_MARGINS, WAKE_CANDIDATES, type Verdict } from '../../../src/main/wake/verify';

const frame = (value = 0): Int16Array => new Int16Array(FRAME_SAMPLES).fill(value);

function fakeFeatureRunner(scores: readonly number[] = []) {
  const calls = { mel: [] as Float32Array[], embed: [] as Float32Array[], classify: [] as Float32Array[] };
  let embedCount = 0;
  const runner: FeatureRunner = {
    melspectrogram: async (samples) => {
      calls.mel.push(samples);
      return new Float32Array(8 * MEL_BINS).fill(10);
    },
    embed: async (mel) => {
      calls.embed.push(mel);
      embedCount += 1;
      return new Float32Array(EMBEDDING_DIM).fill(embedCount);
    },
    classify: async (window) => {
      calls.classify.push(window);
      return scores[calls.classify.length - 1] ?? 0;
    },
  };
  return { runner, calls };
}

describe('WakeFeatures (streaming openWakeWord chain)', () => {
  it('returns no score until 16 embeddings exist, then one score per frame', async () => {
    // Arrange
    const { runner } = fakeFeatureRunner([0.7]);
    const features = new WakeFeatures(runner);

    // Act
    const results = [];
    for (let i = 0; i < WINDOW_EMBEDDINGS; i += 1) results.push(await features.push(frame()));

    // Assert
    expect(results.slice(0, WINDOW_EMBEDDINGS - 1).every((r) => r === null)).toBe(true);
    expect(results.at(-1)).toBeCloseTo(0.7);
  });

  it('feeds the mel model the new frame plus 480 samples of context', async () => {
    const { runner, calls } = fakeFeatureRunner();
    const features = new WakeFeatures(runner);
    await features.push(frame(1));
    await features.push(frame(2));
    expect(calls.mel[0]).toHaveLength(FRAME_SAMPLES);
    expect(calls.mel[1]).toHaveLength(FRAME_SAMPLES + MEL_CONTEXT_SAMPLES);
    expect(calls.mel[1]?.[0]).toBe(1); // context comes from the previous frame
    expect(calls.mel[1]?.at(-1)).toBe(2);
  });

  it('scales mel output like openWakeWord and keeps the latest 76 frames', async () => {
    const { runner, calls } = fakeFeatureRunner();
    const features = new WakeFeatures(runner);
    await features.push(frame());
    const mel = calls.embed[0];
    expect(mel).toHaveLength(MEL_WINDOW * MEL_BINS);
    expect(mel?.[0]).toBe(1); // initial padding of ones
    expect(mel?.at(-1)).toBe(10 / 10 + 2);
  });

  it('gives the classifier the last 16 embeddings, oldest first', async () => {
    const { runner, calls } = fakeFeatureRunner();
    const features = new WakeFeatures(runner);
    for (let i = 0; i < WINDOW_EMBEDDINGS + 2; i += 1) await features.push(frame());
    const window = calls.classify.at(-1);
    expect(window).toHaveLength(WINDOW_EMBEDDINGS * EMBEDDING_DIM);
    expect(window?.[0]).toBe(3);
    expect(window?.at(-1)).toBe(WINDOW_EMBEDDINGS + 2);
  });

  it('starts over after reset', async () => {
    const { runner } = fakeFeatureRunner([0.5, 0.5]);
    const features = new WakeFeatures(runner);
    for (let i = 0; i < WINDOW_EMBEDDINGS; i += 1) await features.push(frame());
    features.reset();
    expect(await features.push(frame())).toBeNull();
  });

  it('rejects frames of the wrong size', async () => {
    const features = new WakeFeatures(fakeFeatureRunner().runner);
    await expect(features.push(new Int16Array(100))).rejects.toThrow(/1280 samples/);
  });
});

describe('AudioRing', () => {
  it('returns the latest samples in order, as floats', () => {
    const ring = new AudioRing(4);
    ring.push(Int16Array.from([1, 2, 3]));
    ring.push(Int16Array.from([4, 5, 16384]));
    expect(Array.from(ring.latest(3))).toEqual([4 / 32768, 5 / 32768, 0.5]);
    expect(ring.size).toBe(4);
  });

  it('never returns more than it holds, and clears', () => {
    const ring = new AudioRing(10);
    ring.push(Int16Array.from([7, 8]));
    expect(ring.latest(5)).toHaveLength(2);
    ring.clear();
    expect(ring.latest(5)).toHaveLength(0);
  });
});

// ── Moonshine decoding ──────────────────────────────────────────────────────
const VOCAB_SIZE = 30_000;
const vocab = Array.from({ length: VOCAB_SIZE }, (_, i) => `t${i}`);
Object.assign(vocab, { 18637: '▁Hey', 29892: ',', 951: '▁Le', 2142: 'af', 29891: 'y', 29889: '.', 365: '▁L', 1700: 'acy', 100: '<0x41>' });

/** A decoder that always predicts `script[position]` (EOS after it) with logit 10, everything else 0. */
function scriptedRunner(script: readonly number[]) {
  const decode = vi.fn(async (_hidden: unknown, rows: readonly (readonly number[])[]): Promise<Logits> => {
    const length = rows[0]?.length ?? 0;
    const data = new Float32Array(rows.length * length * VOCAB_SIZE);
    for (let r = 0; r < rows.length; r += 1) {
      for (let p = 0; p < length; p += 1) data[(r * length + p) * VOCAB_SIZE + (script[p] ?? EOS_TOKEN)] = 10;
    }
    return { data, batch: rows.length, length, vocab: VOCAB_SIZE };
  });
  const encode = vi.fn(async (audio: Float32Array) => audio.length);
  const runner: MoonshineRunner<number> = { encode, decode };
  return { runner, decode, encode };
}

describe('Moonshine decoding', () => {
  it('detokenizes SentencePiece pieces and byte tokens', () => {
    expect(detokenize(vocab, [18637, 29892, 951, 2142, 29891, 29889])).toBe('Hey, Leafy.');
    expect(detokenize(vocab, [1, 100, EOS_TOKEN])).toBe('A');
  });

  it('computes a log-softmax probability', () => {
    const logits: Logits = { data: Float32Array.from([0, Math.log(3)]), batch: 1, length: 1, vocab: 2 };
    expect(logProb(logits, 0, 0, 1)).toBeCloseTo(Math.log(3 / 4));
  });

  it('decodes greedily until EOS', async () => {
    const { runner } = scriptedRunner([18637, 365, 1700]);
    const heard = await greedy(runner, 0);
    expect(heard.tokens).toEqual([18637, 365, 1700]);
    expect(heard.logProb).toBeLessThan(0);
  });

  it('stops after MAX_TRANSCRIPT_TOKENS without EOS', async () => {
    const { runner } = scriptedRunner(new Array<number>(40).fill(1700));
    const heard = await greedy(runner, 0);
    expect(heard.tokens).toHaveLength(MAX_TRANSCRIPT_TOKENS);
  });

  it('scores sequences in one right-padded batch', async () => {
    const { runner, decode } = scriptedRunner([18637, 365]);
    const scores = await scoreSequences(runner, 0, [[18637, 365], [18637]]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0]?.[1]).toEqual([[1, 18637, 365], [1, 18637, EOS_TOKEN]]);
    expect(scores[0]).toBeGreaterThan(scores[1] ?? 0); // the script's own sequence is the most likely
  });

  it('normalizes loud and quiet audio to the same peak, and leaves silence alone', () => {
    expect(Math.max(...normalizePeak(Float32Array.from([0.01, -0.02])).map(Math.abs))).toBeCloseTo(0.5);
    expect(Array.from(normalizePeak(new Float32Array(3)))).toEqual([0, 0, 0]);
  });

  it('confirms audio whose transcript names Leafy', async () => {
    const { runner } = scriptedRunner(WAKE_CANDIDATES[0] ?? []);
    const verdict = await verifyAudio(runner, vocab, new Float32Array(16).fill(0.1), VERIFY_MARGINS.medium);
    expect(verdict).toMatchObject({ accepted: true, named: true, transcript: 'Hey, Leafy.' });
  });

  it('rejects audio that clearly says something else', async () => {
    const { runner } = scriptedRunner([18637, 365, 1700]); // "Hey Lacy"
    const verdict = await verifyAudio(runner, vocab, new Float32Array(16).fill(0.1), VERIFY_MARGINS.medium);
    expect(verdict.named).toBe(false);
    expect(verdict.accepted).toBe(false);
    expect(verdict.margin).toBeLessThan(-VERIFY_MARGINS.medium);
  });
});

// ── Detector (stage 1 → stage 2) ────────────────────────────────────────────
function detectorHarness(scores: readonly (number | null)[], verdict: Partial<Verdict> = {}) {
  const events: WorkerEvent[] = [];
  let i = 0;
  const features = { push: vi.fn(async () => scores[i++] ?? null), reset: vi.fn() };
  const verify = vi.fn(async () => ({ accepted: true, transcript: 'x', margin: -1, named: false, ...verdict }));
  const detector = new WakeDetector({ features, verify, emit: (e) => events.push(e) }, 'medium');
  const pushAll = async (n: number, fresh: (k: number) => boolean = () => false) => {
    for (let k = 0; k < n; k += 1) await detector.push(frame(k), fresh(k));
  };
  return { detector, events, features, verify, pushAll };
}

describe('WakeDetector', () => {
  it('reports a confirmed detection with its score and margin', async () => {
    const h = detectorHarness([0.1, 0.9]);
    await h.pushAll(2);
    expect(h.events).toEqual([{ type: 'detected', score: 0.9, margin: -1 }]);
  });

  it('reports a candidate the transcription check turned down as rejected', async () => {
    const h = detectorHarness([0.9], { accepted: false, margin: -30 });
    await h.pushAll(1);
    expect(h.events).toEqual([{ type: 'rejected', score: 0.9, margin: -30 }]);
  });

  it('never runs the transcription check below the threshold or during warm-up', async () => {
    const h = detectorHarness([null, null, WAKE_THRESHOLDS.medium - 0.01]);
    await h.pushAll(3);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
  });

  it('checks one candidate per cooldown even if the score stays high', async () => {
    const h = detectorHarness(new Array<number>(COOLDOWN_FRAMES).fill(0.95));
    await h.pushAll(COOLDOWN_FRAMES);
    expect(h.verify).toHaveBeenCalledTimes(1);
  });

  it('transcribes the last 1.5 s of audio with the margin for the current sensitivity', async () => {
    const h = detectorHarness([...new Array<null>(24).fill(null), 0.95]);
    h.detector.setSensitivity('high');
    await h.pushAll(25);
    const [audio, margin] = h.verify.mock.calls[0] as unknown as [Float32Array, number];
    expect(audio).toHaveLength(RING_SAMPLES);
    expect(audio.at(-1)).toBeCloseTo(24 / 32768);
    expect(margin).toBe(VERIFY_MARGINS.high);
  });

  it('starts over on a fresh frame: buffers reset and the old audio is gone', async () => {
    const h = detectorHarness([null, null, 0.95]);
    await h.pushAll(3, (k) => k === 2);
    expect(h.features.reset).toHaveBeenCalledTimes(1);
    const [audio] = h.verify.mock.calls[0] as unknown as [Float32Array];
    expect(audio).toHaveLength(FRAME_SAMPLES);
  });

  it('clamps a non-finite margin so the message stays valid', async () => {
    const h = detectorHarness([0.9], { accepted: false, margin: Number.NEGATIVE_INFINITY });
    await h.pushAll(1);
    expect(h.events[0]).toMatchObject({ type: 'rejected', margin: -1000 });
  });
});
