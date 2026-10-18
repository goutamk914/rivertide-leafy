import type { IslandMode, IslandScene, IslandSize, IslandSizes } from './types';

/**
 * Pure geometry and timing for the island. Everything here is a port of
 * jhaemin/dynamic-island (react-spring) to motion, generalised from its fixed
 * 112 x 32 pill to any size set.
 */

/** Sizes from the original component: 112 x 32 pill, 352 x 72 card, 36 px bubble. */
export const DEFAULT_SIZES: IslandSizes = Object.freeze({
  compact: Object.freeze({ width: 112, height: 32 }),
  stretched: Object.freeze({ width: 200, height: 32 }),
  large: Object.freeze({ width: 352, height: 72 }),
  bubble: 36,
  radius: 36,
});

/** Space between the pill and the detached bubble in split (original: 118 - 112). */
export const SPLIT_GAP = 6;
/** stdDeviation of the metaball blur while the bubble is tucked inside the pill. */
export const GOO_BLUR_REST = 10;
/** The alpha threshold matrix that turns the blur into a gooey edge. */
export const GOO_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 25 -10';
/** Room around the metaball so the blur never clips at the SVG edge. */
const GOO_PAD = 24;

/** react-spring's default friction is 26, so damping 26 keeps the original feel. */
const FRICTION = 26;

export interface IslandSpring {
  readonly type: 'spring';
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export const ISLAND_SPRINGS = Object.freeze({
  /** `flatMove` in the original: snappy, no overshoot. */
  flat: Object.freeze({ type: 'spring', stiffness: 300, damping: FRICTION, mass: 0.1 } as const),
  /** Opening into a card: heavier, with the slight settle iOS is known for. */
  large: Object.freeze({ type: 'spring', stiffness: 250, damping: FRICTION, mass: 1.5 } as const),
  /** Pulling the bubble away from the pill. */
  split: Object.freeze({ type: 'spring', stiffness: 250, damping: FRICTION, mass: 2 } as const),
}) satisfies Record<string, IslandSpring>;

type Capitalized<M extends IslandMode> = Capitalize<M>;
export type TransitionKey = `from${Capitalized<IslandMode>}To${Capitalized<IslandMode>}`;

const capitalize = <M extends IslandMode>(mode: M) => (mode.charAt(0).toUpperCase() + mode.slice(1)) as Capitalized<M>;

export function transitionKey(from: IslandMode, to: IslandMode): TransitionKey {
  return `from${capitalize(from)}To${capitalize(to)}`;
}

export interface TransitionTrack {
  readonly mode: IslandMode;
  readonly sceneId: string | null;
  readonly key: TransitionKey;
}

/**
 * The transition the island is in after this render. A mode change remembers where it came from;
 * a new scene in the same mode decays to X -> X, so e.g. chapter-to-chapter swaps use the same-mode
 * timing instead of the timing of the compact -> stretched move that preceded them.
 */
export function nextTransition(track: TransitionTrack, mode: IslandMode, sceneId: string | null): TransitionTrack {
  if (track.mode !== mode) return { mode, sceneId, key: transitionKey(track.mode, mode) };
  if (track.sceneId !== sceneId) return { mode, sceneId, key: transitionKey(mode, mode) };
  return track;
}

export function mergeSizes(overrides: Partial<IslandSizes> = {}): IslandSizes {
  return { ...DEFAULT_SIZES, ...overrides };
}

/** Capsule size for a mode. In split the pill grows by one bubble + gap, as 112 + 33 + 9 = 154 did. */
export function resolveSize(mode: IslandMode, scene: IslandScene | null, sizes: IslandSizes): IslandSize {
  if (scene?.size) return scene.size;
  if (mode === 'split') {
    return { width: sizes.compact.width + sizes.bubble + SPLIT_GAP, height: sizes.compact.height };
  }
  return sizes[mode];
}

/** Horizontal shift of the pill in split so pill + gap + bubble stay centred on the resting pill. */
export function splitOffset(bubble: number): number {
  return -(SPLIT_GAP + bubble) / 2;
}

export function islandRadius(mode: IslandMode, size: IslandSize, sizes: IslandSizes): number {
  const pill = size.height / 2;
  return mode === 'large' ? Math.min(pill, sizes.radius) : pill;
}

export type ShapeTransition = (IslandSpring & { readonly delay: number }) | { readonly duration: 0; readonly delay: 0 };

export interface IslandTiming {
  /** Capsule width, height, radius and split shift. */
  readonly shape: ShapeTransition;
  /** The detached bubble sliding out of (or back into) the pill. */
  readonly bubble: ShapeTransition;
  /** Incoming content: blur + scale to crisp. Outgoing content always leaves in `exit`. */
  readonly content: { readonly delay: number; readonly duration: number };
  /** Metaball blur (stdDeviation) target and timing. */
  readonly goo: { readonly to: number; readonly duration: number; readonly delay: number };
}

const CONTENT_IN = 0.2;
const CONTENT_OUT = 0.15;
const CONTENT_DELAY = 0.1;
export const CONTENT_EXIT_DURATION = CONTENT_OUT;

const INSTANT = Object.freeze({ duration: 0, delay: 0 } as const);

function shapeTiming(from: IslandMode, to: IslandMode): ShapeTransition {
  if (to === 'large') return { ...ISLAND_SPRINGS.large, delay: from === 'split' ? 0.05 : 0 };
  if (to === 'split') {
    return from === 'large' ? { ...ISLAND_SPRINGS.flat, delay: 0.1 } : { ...ISLAND_SPRINGS.split, delay: 0 };
  }
  // Shrinking waits ~100 ms so the old content can fade first; growing and un-splitting start at once.
  const growing = from === 'compact' && to === 'stretched';
  return { ...ISLAND_SPRINGS.flat, delay: from === 'split' || growing ? 0 : 0.1 };
}

function bubbleTiming(from: IslandMode, to: IslandMode): ShapeTransition {
  if (to !== 'split') return { ...ISLAND_SPRINGS.flat, delay: 0 };
  return { ...ISLAND_SPRINGS.split, delay: from === 'large' ? 0.2 : 0 };
}

const parseKey = (key: TransitionKey): [IslandMode, IslandMode] => {
  const [, from, to] = /^from(\w+?)To(\w+)$/.exec(key) ?? [];
  return [from.toLowerCase() as IslandMode, to.toLowerCase() as IslandMode];
};

export function islandTiming(key: TransitionKey, reducedMotion: boolean): IslandTiming {
  const [from, to] = parseKey(key);
  const gooTarget = to === 'split' ? 0 : GOO_BLUR_REST;
  if (reducedMotion) {
    return {
      shape: INSTANT,
      bubble: INSTANT,
      content: { delay: 0, duration: CONTENT_OUT },
      goo: { to: gooTarget, duration: 0, delay: 0 },
    };
  }
  return {
    shape: shapeTiming(from, to),
    bubble: bubbleTiming(from, to),
    content: { delay: CONTENT_DELAY + (key === 'fromSplitToLarge' ? 0.05 : 0), duration: CONTENT_IN },
    goo: to === 'split' ? { to: 0, duration: 0.4, delay: 0.25 } : { to: GOO_BLUR_REST, duration: 0.1, delay: 0 },
  };
}

export interface GooLayout {
  /** Padding around the shapes inside the SVG. */
  readonly pad: number;
  readonly width: number;
  readonly height: number;
  /** The anchor circle that stays inside the pill's rounded end. */
  readonly circle: { readonly cx: number; readonly cy: number; readonly r: number };
  /** The bubble at rest, tucked inside the pill end. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx: number };
  /** How far the bubble travels to its split position. */
  readonly travel: number;
}

/**
 * Metaball geometry, in an SVG whose origin sits `pad + max(height, bubble)` left of the pill's
 * right end. The circle (r = h/2 - 1, the original's r 15) never moves; the rect slides right.
 */
export function gooLayout(height: number, bubble: number): GooLayout {
  const reach = Math.max(height, bubble);
  const pillEnd = GOO_PAD + reach;
  return {
    pad: GOO_PAD,
    width: GOO_PAD * 2 + reach + SPLIT_GAP + bubble,
    height: GOO_PAD * 2 + height,
    circle: { cx: pillEnd - height / 2, cy: GOO_PAD + height / 2, r: height / 2 - 1 },
    rect: { x: pillEnd - bubble, y: GOO_PAD, width: bubble, height, rx: height / 2 },
    travel: SPLIT_GAP + bubble,
  };
}
