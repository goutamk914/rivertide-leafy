/**
 * Pure window geometry (no Electron): where each window goes on a display's work area.
 */
import type { Settings } from '../../shared/settings';

export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly width: number; readonly height: number }
export interface Rect extends Point, Size {}

export const DASHBOARD_SIZE: Size = { width: 1180, height: 780 };
export const DASHBOARD_MIN_SIZE: Size = { width: 900, height: 620 };
export const ISLAND_SIZE: Size = { width: 460, height: 260 };
// 720 px card + 16 px shadow gutter on each side (the renderer draws the card inside the gutter).
export const PALETTE_SIZE: Size = { width: 752, height: 560 };
export const LEAFY_SIZES: Readonly<Record<Settings['leafy']['size'], Size>> = {
  small: { width: 180, height: 220 },
  medium: { width: 240, height: 280 },
  large: { width: 300, height: 350 },
};

export const ISLAND_TOP_GAP = 6;
export const PALETTE_TOP_RATIO = 0.22;
export const LEAFY_MARGIN = 24;

/** Moves `rect` (same size) so it lies inside `area`; if larger than the area, pins it top-left. */
export function clampToArea(rect: Rect, area: Rect): Rect {
  const maxX = area.x + area.width - rect.width;
  const maxY = area.y + area.height - rect.height;
  return {
    x: Math.round(Math.max(area.x, Math.min(rect.x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(rect.y, maxY))),
    width: rect.width,
    height: rect.height,
  };
}

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Top-centre of the work area, just under the menu bar / notch. */
export function islandBounds(area: Rect, size: Size = ISLAND_SIZE): Rect {
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: area.y + ISLAND_TOP_GAP,
    width: size.width,
    height: size.height,
  };
}

/** Horizontally centred, top edge at 22 % of the work area's height. */
export function paletteBounds(area: Rect, size: Size = PALETTE_SIZE): Rect {
  return clampToArea({
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + area.height * PALETTE_TOP_RATIO),
    width: size.width,
    height: size.height,
  }, area);
}

/** Keeps the top edge fixed and changes only the height (clamped to the area's bottom). */
export function resizeKeepingTop(rect: Rect, height: number, area: Rect): Rect {
  const maxHeight = Math.max(1, area.y + area.height - rect.y);
  return { ...rect, height: Math.round(Math.min(height, maxHeight)) };
}

/** Bottom-right of the work area with a margin. */
export function leafyDefaultBounds(area: Rect, size: Size): Rect {
  return {
    x: area.x + area.width - size.width - LEAFY_MARGIN,
    y: area.y + area.height - size.height - LEAFY_MARGIN,
    width: size.width,
    height: size.height,
  };
}

/** Which half of the display the window's centre is in. */
export function cornerOf(rect: Rect, area: Rect): 'left' | 'right' {
  return centerOf(rect).x < area.x + area.width / 2 ? 'left' : 'right';
}

/**
 * Resizes keeping the bottom edge and the side nearest the screen edge fixed, so Leafy grows
 * away from the corner it sits in. The result is clamped to the area.
 */
export function resizeAnchored(rect: Rect, size: Size, area: Rect): Rect {
  const anchorRight = cornerOf(rect, area) === 'right';
  const x = anchorRight ? rect.x + rect.width - size.width : rect.x;
  const y = rect.y + rect.height - size.height;
  return clampToArea({ x, y, width: size.width, height: size.height }, area);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
