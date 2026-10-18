import type { ReactNode } from 'react';

/**
 * The four shapes the capsule can take, after jhaemin/dynamic-island:
 * - `compact`   the resting pill
 * - `stretched` a wider pill with leading + trailing slots
 * - `split`     the pill plus a detached bubble, pulled apart with a gooey metaball
 * - `large`     an expanded card with arbitrary content
 */
export type IslandMode = 'compact' | 'stretched' | 'split' | 'large';

export interface IslandSize {
  readonly width: number;
  readonly height: number;
}

export interface IslandScene {
  /** Stable id. A new id cross-fades the content even when the mode stays the same. */
  readonly id: string;
  readonly mode: IslandMode;
  /** Left slot in compact, stretched and split. */
  readonly leading?: ReactNode;
  /** Right slot in compact, stretched and split. */
  readonly trailing?: ReactNode;
  /** Content of the large card. Stays in the accessibility tree, so it may hold controls. */
  readonly body?: ReactNode;
  /** Content of the detached circle in split. */
  readonly bubble?: ReactNode;
  /** Per-scene capsule size (large cards vary). In split this is the pill without the bubble. */
  readonly size?: IslandSize;
  /**
   * What assistive tech should hear when this scene appears, e.g. "Listening".
   * Leading, trailing and bubble are glanceable visuals and stay hidden from assistive tech;
   * this label speaks for them through the island's polite status region.
   */
  readonly label?: string;
}

export interface IslandSizes {
  readonly compact: IslandSize;
  readonly stretched: IslandSize;
  readonly large: IslandSize;
  /** Width of the detached bubble in split; its height follows the pill. */
  readonly bubble: number;
  /** Largest corner radius for large cards (pills are always fully round). */
  readonly radius: number;
}

export interface DynamicIslandProps {
  /** `null` is the empty resting pill. */
  readonly scene: IslandScene | null;
  readonly sizes?: Partial<IslandSizes>;
  readonly onPointerEnter?: () => void;
  readonly onPointerLeave?: () => void;
  /** Overrides the OS setting. Reduced motion = instant size changes + opacity-only content fades. */
  readonly reducedMotion?: boolean;
  readonly className?: string;
  readonly 'aria-label'?: string;
  /**
   * Persistent controls inside the capsule, e.g. a disclosure button. They come first in DOM (and
   * tab) order and stay mounted across scenes, so focus is never lost when the island changes
   * shape. Give them a z-index to sit above the scene content.
   */
  readonly children?: ReactNode;
}
