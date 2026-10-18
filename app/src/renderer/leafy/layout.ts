/**
 * Pure layout for the Leafy window. Leafy stands at the bottom on the screen-edge side
 * (`corner`), and the toolbar and speech bubble open toward the side with more room.
 * All values are CSS px inside the transparent window.
 */
import type { Settings } from '@shared/settings';

export type Corner = 'left' | 'right';

/** Sprite grid is 24 x 28 pixels. */
export const SPRITE_COLUMNS = 24;
export const SPRITE_ROWS = 28;

export const LEAFY_SCALE: Readonly<Record<Settings['leafy']['size'], number>> = { small: 3, medium: 4, large: 5 };

/** Toolbar: three 44 px buttons, 4 px gaps, 4 px padding. */
export const TOOLBAR_BUTTON = 44;
export const TOOLBAR_GAP = 4;
export const TOOLBAR_PAD = 4;
export const TOOLBAR_WIDTH = TOOLBAR_BUTTON * 3 + TOOLBAR_GAP * 2 + TOOLBAR_PAD * 2;
export const TOOLBAR_HEIGHT = TOOLBAR_BUTTON + TOOLBAR_PAD * 2;

const BOTTOM_MARGIN = 6;
/** Empty rows above Leafy's leaves in most poses; the toolbar and bubble may float over them. */
export const SPRITE_HEADROOM_ROWS = 6;
const EDGE_MARGIN = 8;
const STACK_GAP = 6;
/** The bubble's tail must sit at least this far inside its edge. */
const TAIL_INSET = 22;

export interface LeafyLayoutInput {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly corner: Corner;
}

export interface LeafyLayout {
  readonly sprite: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** Toolbar box, horizontally centred on Leafy and clamped into the window. */
  readonly toolbar: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly bubble: {
    /** The bubble hugs this window edge and grows toward the other one. */
    readonly side: Corner;
    readonly inset: number;
    readonly maxWidth: number;
    readonly minWidth: number;
    /** Distance from the window bottom to the bubble's bottom: resting, and lifted above the toolbar. */
    readonly bottom: number;
    readonly bottomLifted: number;
    /** Tail position measured from the hugged edge of the bubble. */
    readonly tailOffset: number;
  };
}

const clampTo = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function leafyLayout({ width, height, scale, corner }: LeafyLayoutInput): LeafyLayout {
  const spriteWidth = SPRITE_COLUMNS * scale;
  const spriteHeight = SPRITE_ROWS * scale;
  const fromEdge = Math.max(spriteWidth / 2 + EDGE_MARGIN, TOOLBAR_WIDTH / 2 + EDGE_MARGIN);
  const centerX = corner === 'right' ? width - fromEdge : fromEdge;
  const spriteTop = height - BOTTOM_MARGIN - spriteHeight;
  const headTop = spriteTop + SPRITE_HEADROOM_ROWS * scale;

  const toolbarLeft = clampTo(centerX - TOOLBAR_WIDTH / 2, EDGE_MARGIN, width - EDGE_MARGIN - TOOLBAR_WIDTH);
  const toolbarTop = headTop - STACK_GAP - TOOLBAR_HEIGHT;

  const tailOffset = corner === 'right' ? width - EDGE_MARGIN - centerX : centerX - EDGE_MARGIN;
  return {
    sprite: { left: centerX - spriteWidth / 2, top: spriteTop, width: spriteWidth, height: spriteHeight },
    toolbar: { left: toolbarLeft, top: toolbarTop, width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT },
    bubble: {
      side: corner,
      inset: EDGE_MARGIN,
      maxWidth: Math.max(0, width - EDGE_MARGIN * 2),
      minWidth: Math.min(width - EDGE_MARGIN * 2, tailOffset + TAIL_INSET),
      bottom: height - headTop + STACK_GAP,
      bottomLifted: height - toolbarTop + STACK_GAP,
      tailOffset,
    },
  };
}
