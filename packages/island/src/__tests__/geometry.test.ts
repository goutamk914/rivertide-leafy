import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZES,
  GOO_BLUR_REST,
  ISLAND_SPRINGS,
  SPLIT_GAP,
  gooLayout,
  islandRadius,
  islandTiming,
  mergeSizes,
  nextTransition,
  resolveSize,
  splitOffset,
  transitionKey,
} from '../geometry';
import type { IslandScene } from '../types';

const scene = (overrides: Partial<IslandScene>): IslandScene => ({ id: 'test', mode: 'compact', ...overrides });

describe('transitionKey', () => {
  it('names the move from one mode to another like the original fromXToY keys', () => {
    expect(transitionKey('split', 'large')).toBe('fromSplitToLarge');
    expect(transitionKey('large', 'split')).toBe('fromLargeToSplit');
    expect(transitionKey('compact', 'compact')).toBe('fromCompactToCompact');
  });
});

describe('nextTransition', () => {
  const start = { mode: 'compact' as const, sceneId: 'rest', key: transitionKey('compact', 'compact') };

  it('keeps the same record when nothing changed', () => {
    expect(nextTransition(start, 'compact', 'rest')).toBe(start);
  });

  it('records where a mode change came from', () => {
    expect(nextTransition(start, 'stretched', 'chapter:a').key).toBe('fromCompactToStretched');
  });

  it('decays to a same-mode key when only the scene changes', () => {
    const stretched = nextTransition(start, 'stretched', 'chapter:a');
    const next = nextTransition(stretched, 'stretched', 'chapter:b');
    expect(next.key).toBe('fromStretchedToStretched');
    expect(next.sceneId).toBe('chapter:b');
  });
});

describe('mergeSizes', () => {
  it('returns the reference sizes when nothing is overridden', () => {
    expect(mergeSizes()).toEqual(DEFAULT_SIZES);
  });

  it('keeps defaults for every size the caller leaves out', () => {
    const merged = mergeSizes({ compact: { width: 124, height: 36 } });
    expect(merged.compact).toEqual({ width: 124, height: 36 });
    expect(merged.large).toEqual(DEFAULT_SIZES.large);
    expect(merged.bubble).toBe(DEFAULT_SIZES.bubble);
  });

  it('does not mutate the defaults', () => {
    mergeSizes({ bubble: 50 });
    expect(DEFAULT_SIZES.bubble).toBe(36);
  });
});

describe('resolveSize', () => {
  const sizes = mergeSizes();

  it('uses the mode size when the scene has no override', () => {
    expect(resolveSize('compact', null, sizes)).toEqual({ width: 112, height: 32 });
    expect(resolveSize('large', scene({ mode: 'large' }), sizes)).toEqual({ width: 352, height: 72 });
    expect(resolveSize('stretched', scene({ mode: 'stretched' }), sizes)).toEqual(sizes.stretched);
  });

  it('prefers the per-scene size for any mode', () => {
    const card = { width: 340, height: 228 };
    expect(resolveSize('large', scene({ mode: 'large', size: card }), sizes)).toEqual(card);
    expect(resolveSize('stretched', scene({ mode: 'stretched', size: { width: 260, height: 32 } }), sizes).width).toBe(260);
  });

  it('grows the pill by one bubble and one gap in split, as in the original (112 + 33 + 9 = 154)', () => {
    expect(resolveSize('split', scene({ mode: 'split' }), sizes)).toEqual({ width: 154, height: 32 });
  });
});

describe('splitOffset', () => {
  it('shifts the pill left by half of bubble + gap so pill, gap and bubble stay centred', () => {
    expect(splitOffset(36)).toBe(-21);
    expect(splitOffset(40)).toBe(-(SPLIT_GAP + 40) / 2);
  });
});

describe('islandRadius', () => {
  const sizes = mergeSizes();

  it('is a full pill in compact, stretched and split', () => {
    expect(islandRadius('compact', { width: 112, height: 32 }, sizes)).toBe(16);
    expect(islandRadius('split', { width: 154, height: 36 }, sizes)).toBe(18);
  });

  it('caps the corner radius of tall large cards', () => {
    expect(islandRadius('large', { width: 352, height: 72 }, sizes)).toBe(36);
    expect(islandRadius('large', { width: 340, height: 240 }, sizes)).toBe(sizes.radius);
  });
});

describe('islandTiming', () => {
  it('ports the react-spring configs: tension to stiffness, friction 26 to damping, same mass', () => {
    expect(ISLAND_SPRINGS.flat).toMatchObject({ type: 'spring', stiffness: 300, damping: 26, mass: 0.1 });
    expect(ISLAND_SPRINGS.large).toMatchObject({ stiffness: 250, damping: 26, mass: 1.5 });
    expect(ISLAND_SPRINGS.split).toMatchObject({ stiffness: 250, damping: 26, mass: 2 });
  });

  it('expands to large immediately, and 50 ms late when coming out of split', () => {
    expect(islandTiming('fromCompactToLarge', false).shape).toMatchObject({ ...ISLAND_SPRINGS.large, delay: 0 });
    expect(islandTiming('fromSplitToLarge', false).shape.delay).toBe(0.05);
    expect(islandTiming('fromSplitToLarge', false).content.delay).toBeCloseTo(0.15);
  });

  it('lets content leave before the capsule shrinks back to a pill', () => {
    expect(islandTiming('fromLargeToCompact', false).shape).toMatchObject({ ...ISLAND_SPRINGS.flat, delay: 0.1 });
    expect(islandTiming('fromSplitToCompact', false).shape.delay).toBe(0);
    expect(islandTiming('fromCompactToStretched', false).shape.delay).toBe(0);
  });

  it('splits with the heavy spring, or the flat one after a large card', () => {
    const fromCompact = islandTiming('fromCompactToSplit', false);
    expect(fromCompact.shape).toMatchObject({ ...ISLAND_SPRINGS.split, delay: 0 });
    expect(fromCompact.bubble).toMatchObject({ ...ISLAND_SPRINGS.split, delay: 0 });

    const fromLarge = islandTiming('fromLargeToSplit', false);
    expect(fromLarge.shape).toMatchObject({ ...ISLAND_SPRINGS.flat, delay: 0.1 });
    expect(fromLarge.bubble.delay).toBe(0.2);
  });

  it('sharpens the goo only once the bubble has left, and blurs it back fast', () => {
    expect(islandTiming('fromCompactToSplit', false).goo).toEqual({ to: 0, duration: 0.4, delay: 0.25 });
    expect(islandTiming('fromSplitToCompact', false).goo).toEqual({ to: GOO_BLUR_REST, duration: 0.1, delay: 0 });
  });

  it('drops every spring and delay under reduced motion', () => {
    const reduced = islandTiming('fromCompactToLarge', true);
    expect(reduced.shape).toEqual({ duration: 0, delay: 0 });
    expect(reduced.bubble).toEqual({ duration: 0, delay: 0 });
    expect(reduced.content.delay).toBe(0);
    expect(reduced.goo.duration).toBe(0);
  });
});

describe('gooLayout', () => {
  it('anchors the metaball at the pill end and parks the bubble inside it at rest', () => {
    const layout = gooLayout(32, 36);
    const pillEnd = layout.pad + 36;
    expect(layout.circle.cx).toBe(pillEnd - 16);
    expect(layout.circle.r).toBe(15);
    expect(layout.rect.x + layout.rect.width).toBe(pillEnd);
    expect(layout.travel).toBe(SPLIT_GAP + 36);
    expect(layout.width).toBe(layout.pad * 2 + 36 + SPLIT_GAP + 36);
  });
});
