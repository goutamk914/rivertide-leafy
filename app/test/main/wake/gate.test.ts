import { describe, expect, it } from 'vitest';
import { COOLDOWN_FRAMES, gateConfig, INITIAL_GATE, stepGate, WAKE_THRESHOLDS, type GateConfig, type GateState } from '../../../src/main/wake/gate';
import { candidateSequences, decide, MAX_PREFIX_TOKENS, namesLeafy, VERIFY_MARGINS, WAKE_CANDIDATES } from '../../../src/main/wake/verify';

function run(scores: readonly (number | null)[], config: GateConfig): { fires: number[]; state: GateState } {
  let state = INITIAL_GATE;
  const fires: number[] = [];
  scores.forEach((score, i) => {
    const step = stepGate(state, score, config);
    state = step.state;
    if (step.fire) fires.push(i);
  });
  return { fires, state };
}

describe('stage 1 gate', () => {
  const config = gateConfig('medium');

  it('fires on the first frame at or above the threshold', () => {
    // Arrange
    const scores = [0.1, 0.2, WAKE_THRESHOLDS.medium, 0.1];

    // Act
    const { fires } = run(scores, config);

    // Assert
    expect(fires).toEqual([2]);
  });

  it('never fires on frames without a score (feature buffers still filling)', () => {
    const { fires } = run([null, null, null], config);
    expect(fires).toEqual([]);
  });

  it('stays quiet for the cooldown after a candidate, then can fire again', () => {
    // Arrange: a long run of high scores
    const scores = new Array<number>(COOLDOWN_FRAMES * 2 + 3).fill(0.99);

    // Act
    const { fires } = run(scores, config);

    // Assert
    expect(fires).toEqual([0, COOLDOWN_FRAMES + 1, 2 * COOLDOWN_FRAMES + 2]);
  });

  it('requires `patience` consecutive frames when configured', () => {
    const patient = { ...config, patience: 3 };
    expect(run([0.9, 0.9, 0.1, 0.9, 0.9, 0.9], patient).fires).toEqual([5]);
  });

  it('treats NaN scores as below threshold', () => {
    expect(run([Number.NaN, Number.NaN], config).fires).toEqual([]);
  });

  it('does not mutate the previous state', () => {
    const before = { ...INITIAL_GATE };
    stepGate(INITIAL_GATE, 0.99, config);
    expect(INITIAL_GATE).toEqual(before);
  });

  it('orders thresholds so higher sensitivity accepts lower scores', () => {
    expect(WAKE_THRESHOLDS.high).toBeLessThan(WAKE_THRESHOLDS.medium);
    expect(WAKE_THRESHOLDS.medium).toBeLessThan(WAKE_THRESHOLDS.low);
    expect(VERIFY_MARGINS.high).toBeGreaterThan(VERIFY_MARGINS.medium);
    expect(VERIFY_MARGINS.medium).toBeGreaterThan(VERIFY_MARGINS.low);
  });
});

describe('stage 2 decision', () => {
  it.each([
    'Hey, Leafy.',
    'hey leafy',
    'Okay. Hey, Leafie!',
    'HEY LEAFEY',
    'Heyleafy.',
    'Hay, leafy?',
  ])('accepts a transcript that names Leafy: %s', (transcript) => {
    expect(namesLeafy(transcript)).toBe(true);
  });

  it.each([
    'Hey, Lucy.',
    'Leafy greens are good for you.',
    'We live on a leafy street.',
    'Hey, lefty.',
    'Healthy',
    '',
  ])('does not treat this as naming Leafy: %s', (transcript) => {
    expect(namesLeafy(transcript)).toBe(false);
  });

  it('accepts when the wake phrase is within the margin of what the model heard', () => {
    // Arrange: the model heard "Hey, Lacy." at -3; "Hey, Leafy." scores -9 (6 nats behind)
    const verdict = decide('Hey, Lacy.', -3, [-12, -9, -20], 8);

    // Assert
    expect(verdict).toMatchObject({ accepted: true, named: false, margin: -6 });
  });

  it('rejects when the wake phrase is far less likely than the transcript', () => {
    const verdict = decide('Hey, let me see.', -2, [-25, -30], 8);
    expect(verdict.accepted).toBe(false);
    expect(verdict.margin).toBe(-23);
  });

  it('accepts a named transcript even when the margin is poor', () => {
    expect(decide('Hey, Leafy.', -1, [-40], 8).accepted).toBe(true);
  });

  it('rejects when nothing could be scored', () => {
    const verdict = decide('', Number.NEGATIVE_INFINITY, [], 8);
    expect(verdict.accepted).toBe(false);
    expect(verdict.margin).toBe(Number.NEGATIVE_INFINITY);
  });

  it('scores every candidate after every transcript prefix, capped at MAX_PREFIX_TOKENS', () => {
    // Arrange
    const heard = [10, 11, 12, 13, 14, 15, 16, 17];

    // Act
    const sequences = candidateSequences(heard);

    // Assert
    expect(sequences).toHaveLength((MAX_PREFIX_TOKENS + 1) * WAKE_CANDIDATES.length);
    expect(sequences[0]).toEqual(WAKE_CANDIDATES[0]);
    expect(sequences.at(-1)).toEqual([...heard.slice(0, MAX_PREFIX_TOKENS), ...(WAKE_CANDIDATES.at(-1) ?? [])]);
  });

  it('scores the bare candidates for an empty transcript', () => {
    expect(candidateSequences([])).toEqual(WAKE_CANDIDATES.map((c) => [...c]));
  });
});
