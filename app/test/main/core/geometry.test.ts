import { describe, expect, it } from 'vitest';
import {
  clampToArea, cornerOf, ISLAND_SIZE, islandBounds, LEAFY_SIZES, leafyDefaultBounds, PALETTE_SIZE, paletteBounds,
  rectsIntersect, resizeAnchored, resizeKeepingTop,
} from '../../../src/main/windows/geometry';

const AREA = { x: 0, y: 25, width: 1440, height: 875 };
const SECOND = { x: 1440, y: 0, width: 1920, height: 1080 };

describe('window geometry', () => {
  it('puts the island top-centre, 6 px under the work area top', () => {
    expect(islandBounds(AREA)).toEqual({ x: 490, y: 31, width: ISLAND_SIZE.width, height: ISLAND_SIZE.height });
    expect(islandBounds(SECOND).x).toBe(1440 + 730);
  });

  it('puts the palette centred at 22 % of the work area height', () => {
    expect(paletteBounds(AREA)).toEqual({ x: AREA.x + Math.round((AREA.width - PALETTE_SIZE.width) / 2), y: 25 + Math.round(875 * 0.22), width: PALETTE_SIZE.width, height: PALETTE_SIZE.height });
  });

  it('keeps the palette on screen on a short display', () => {
    // Arrange
    const short = { x: 0, y: 0, width: 800, height: 600 };

    // Act
    const bounds = paletteBounds(short);

    // Assert
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
  });

  it('resizes the palette keeping the top edge and never past the bottom', () => {
    // Arrange
    const rect = { x: 360, y: 200, width: 720, height: 560 };

    // Act / Assert
    expect(resizeKeepingTop(rect, 120, AREA)).toEqual({ ...rect, height: 120 });
    expect(resizeKeepingTop(rect, 720, AREA).height).toBe(25 + 875 - 200);
  });

  it('places Leafy bottom-right with a 24 px margin', () => {
    expect(leafyDefaultBounds(AREA, LEAFY_SIZES.medium)).toEqual({ x: 1440 - 240 - 24, y: 25 + 875 - 280 - 24, width: 240, height: 280 });
  });

  it('clamps a rect into the work area', () => {
    expect(clampToArea({ x: -50, y: 2000, width: 240, height: 280 }, AREA)).toEqual({ x: 0, y: 25 + 875 - 280, width: 240, height: 280 });
    expect(clampToArea({ x: 100.6, y: 100.4, width: 10, height: 10 }, AREA)).toEqual({ x: 101, y: 100, width: 10, height: 10 });
  });

  it('reports which half of the display Leafy is in', () => {
    expect(cornerOf({ x: 10, y: 0, width: 240, height: 280 }, AREA)).toBe('left');
    expect(cornerOf({ x: 1200, y: 0, width: 240, height: 280 }, AREA)).toBe('right');
    expect(cornerOf({ x: 1500, y: 0, width: 240, height: 280 }, SECOND)).toBe('left');
  });

  it('grows Leafy away from its corner when the size changes', () => {
    // Arrange
    const right = leafyDefaultBounds(AREA, LEAFY_SIZES.medium);
    const left = { x: 24, y: right.y, width: 240, height: 280 };

    // Act
    const grownRight = resizeAnchored(right, LEAFY_SIZES.large, AREA);
    const grownLeft = resizeAnchored(left, LEAFY_SIZES.large, AREA);

    // Assert
    expect(grownRight.x + grownRight.width).toBe(right.x + right.width);
    expect(grownRight.y + grownRight.height).toBe(right.y + right.height);
    expect(grownLeft.x).toBe(24);
    expect(grownLeft.width).toBe(300);
  });

  it('detects intersecting rects', () => {
    expect(rectsIntersect(AREA, SECOND)).toBe(false);
    expect(rectsIntersect(AREA, { x: 1400, y: 0, width: 100, height: 100 })).toBe(true);
  });
});
