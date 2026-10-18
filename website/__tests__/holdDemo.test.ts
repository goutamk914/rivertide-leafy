import { describe, expect, it } from 'vitest';
import { demoReducer, type DemoState } from '@/components/home/hero/useHoldDemo';
import { HERO_CHECKPOINTS, HERO_WORDS, checkpointFor } from '@/content/demo';

const idle: DemoState = { phase: 'idle', heard: 0, result: null, pressedAt: 0, ignoreRelease: false };

const run = (state: DemoState, ...actions: Parameters<typeof demoReducer>[1][]) => actions.reduce(demoReducer, state);
const words = (count: number) => Array.from({ length: count }, () => ({ type: 'word' as const }));

describe('hold-fn demo', () => {
  it('listens while held and polishes on release', () => {
    const state = run(idle, { type: 'press', at: 0 }, ...words(10), { type: 'release', at: 3000 });
    expect(state.phase).toBe('polishing');
    expect(state.result?.cleaned).toBe('I need to email.');
    expect(run(state, { type: 'polished' }).phase).toBe('pasted');
  });

  it('says it did not catch anything when released before a usable phrase', () => {
    const state = run(idle, { type: 'press', at: 0 }, ...words(2), { type: 'release', at: 900 });
    expect(state.phase).toBe('missed');
    expect(state.result).toBeNull();
  });

  it('locks on with a quick double press and stops on the next press', () => {
    const tapped = run(idle, { type: 'press', at: 0 }, { type: 'release', at: 120 });
    expect(tapped.phase).toBe('tapWait');
    const locked = run(tapped, { type: 'press', at: 300 }, { type: 'release', at: 380 }, ...words(HERO_WORDS.length));
    expect(locked.phase).toBe('locked');
    expect(locked.heard).toBe(HERO_WORDS.length);
    const stopped = run(locked, { type: 'press', at: 9000 }, { type: 'release', at: 9100 });
    expect(stopped.phase).toBe('polishing');
    expect(stopped.result?.cleaned).toBe('I need to email the doctor about the appointment on Friday.');
  });

  it('treats a single quick tap as a missed recording once the double-press window closes', () => {
    const tapped = run(idle, { type: 'press', at: 0 }, { type: 'release', at: 120 });
    expect(run(tapped, { type: 'finish' }).phase).toBe('missed');
  });

  it('never hears more words than the example has', () => {
    const state = run(idle, { type: 'press', at: 0 }, ...words(HERO_WORDS.length + 8));
    expect(state.heard).toBe(HERO_WORDS.length);
  });
});

describe('hero checkpoints', () => {
  it('only drops words that were already heard', () => {
    for (const checkpoint of HERO_CHECKPOINTS) {
      expect(checkpoint.dropped.every((index) => index < checkpoint.heard)).toBe(true);
    }
  });

  it('keeps every word of the cleaned sentence from what was said', () => {
    const final = HERO_CHECKPOINTS[HERO_CHECKPOINTS.length - 1];
    const kept = HERO_WORDS.filter((_, index) => !final.dropped.includes(index)).join(' ');
    expect(kept.replace(/[,.]/g, '')).toBe(final.cleaned.replace(/[,.]/g, ''));
  });

  it('picks the most complete checkpoint for the words heard so far', () => {
    expect(checkpointFor(3)).toBeNull();
    expect(checkpointFor(12)?.heard).toBe(10);
    expect(checkpointFor(HERO_WORDS.length)?.heard).toBe(HERO_WORDS.length);
  });
});
