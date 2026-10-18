import { describe, expect, it } from 'vitest';
import {
  bandScale, clamp, columnPath, isolatedPoints, labelAnchor, linePath, lineSegments, linearScale, niceDomain, niceTicks,
  pointScale, tickIndices, tickStep, tidy,
} from '../../../../src/renderer/dashboard/pages/insights/scales';

describe('tidy and clamp', () => {
  it('removes floating point noise', () => {
    // Arrange + Act + Assert
    expect(tidy(0.1 + 0.2)).toBe(0.3);
  });

  it('keeps a value inside the bounds', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });
});

describe('linearScale', () => {
  it('maps the domain onto the range, including an inverted pixel range', () => {
    // Arrange
    const y = linearScale([0, 100], [200, 0]);

    // Act + Assert
    expect(y.map(0)).toBe(200);
    expect(y.map(100)).toBe(0);
    expect(y.map(25)).toBe(150);
  });

  it('inverts pixels back to values', () => {
    // Arrange
    const x = linearScale([10, 20], [0, 100]);

    // Act + Assert
    expect(x.invert(50)).toBe(15);
  });

  it('puts every value in the middle when the domain has no width', () => {
    // Arrange
    const flat = linearScale([5, 5], [0, 100]);

    // Act + Assert
    expect(flat.map(5)).toBe(50);
    expect(flat.map(99)).toBe(50);
  });

  it('inverts to the domain start when the range has no width', () => {
    expect(linearScale([3, 9], [40, 40]).invert(40)).toBe(3);
  });
});

describe('tickStep', () => {
  it('picks 1, 2 or 5 times a power of ten', () => {
    expect(tickStep(0, 100, 4)).toBe(20);
    expect(tickStep(0, 10, 5)).toBe(2);
    expect(tickStep(0, 1284, 4)).toBe(500);
    expect(tickStep(0, 1, 4)).toBe(0.2);
    expect(tickStep(0, 7, 10)).toBe(0.5);
    expect(tickStep(0, 9, 10)).toBe(1);
  });

  it('returns 0 for an empty span, no ticks or non-finite input', () => {
    expect(tickStep(5, 5, 4)).toBe(0);
    expect(tickStep(0, 10, 0)).toBe(0);
    expect(tickStep(0, Number.POSITIVE_INFINITY, 4)).toBe(0);
  });
});

describe('niceTicks', () => {
  it('returns round values inside the extent', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 1284, 4)).toEqual([0, 500, 1000]);
  });

  it('handles decimals without floating point noise', () => {
    expect(niceTicks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('accepts a reversed extent', () => {
    expect(niceTicks(10, 0, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('returns the single value when the extent is flat', () => {
    expect(niceTicks(7, 7)).toEqual([7]);
  });

  it('returns nothing for non-finite input', () => {
    expect(niceTicks(Number.NaN, 4)).toEqual([]);
  });
});

describe('niceDomain', () => {
  it('extends outward to tick boundaries', () => {
    expect(niceDomain(0, 1284, 4)).toEqual([0, 1500]);
    expect(niceDomain(103, 131, 3)).toEqual([100, 140]);
  });

  it('keeps an already nice domain unchanged', () => {
    expect(niceDomain(0, 100, 4)).toEqual([0, 100]);
  });

  it('opens up a flat domain around its value', () => {
    expect(niceDomain(0, 0, 4)).toEqual([0, 1]);
    const [lo, hi] = niceDomain(50, 50, 4);
    expect(lo).toBeLessThan(50);
    expect(hi).toBeGreaterThan(50);
  });
});

describe('bandScale', () => {
  it('centres each band in its slot', () => {
    // Arrange
    const x = bandScale(4, [0, 100], 0.2);

    // Act + Assert
    expect(x.step).toBe(25);
    expect(x.bandwidth).toBe(20);
    expect(x.center(0)).toBe(12.5);
    expect(x.center(3)).toBe(87.5);
  });

  it('finds the band under a pixel and clamps outside the range', () => {
    const x = bandScale(4, [0, 100]);
    expect(x.indexAt(30)).toBe(1);
    expect(x.indexAt(-10)).toBe(0);
    expect(x.indexAt(500)).toBe(3);
  });

  it('reports no band when empty', () => {
    const x = bandScale(0, [0, 100]);
    expect(x.step).toBe(0);
    expect(x.indexAt(10)).toBe(-1);
  });
});

describe('pointScale', () => {
  it('spreads points from the first to the last pixel', () => {
    // Arrange
    const x = pointScale(5, [0, 100]);

    // Act + Assert
    expect(x.position(0)).toBe(0);
    expect(x.position(4)).toBe(100);
    expect(x.step).toBe(25);
  });

  it('snaps a pixel to the nearest point', () => {
    const x = pointScale(5, [0, 100]);
    expect(x.indexAt(30)).toBe(1);
    expect(x.indexAt(40)).toBe(2);
    expect(x.indexAt(-50)).toBe(0);
    expect(x.indexAt(1000)).toBe(4);
  });

  it('centres a single point and reports nothing for an empty series', () => {
    expect(pointScale(1, [0, 100]).position(0)).toBe(50);
    expect(pointScale(1, [0, 100]).indexAt(80)).toBe(0);
    expect(pointScale(0, [0, 100]).indexAt(80)).toBe(-1);
  });
});

describe('tickIndices', () => {
  it('returns every index when they all fit', () => {
    expect(tickIndices(5, 7)).toEqual([0, 1, 2, 3, 4]);
  });

  it('spaces indices evenly and always ends on the latest', () => {
    // Arrange + Act
    const ticks = tickIndices(90, 6);

    // Assert
    expect(ticks[ticks.length - 1]).toBe(89);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks).toEqual([17, 35, 53, 71, 89]);
  });

  it('handles one tick, no ticks and no data', () => {
    expect(tickIndices(10, 1)).toEqual([9]);
    expect(tickIndices(10, 0)).toEqual([]);
    expect(tickIndices(0, 4)).toEqual([]);
  });
});

describe('labelAnchor', () => {
  it('anchors labels near the edges inward', () => {
    expect(labelAnchor(5, 0, 200, 20)).toBe('start');
    expect(labelAnchor(195, 0, 200, 20)).toBe('end');
    expect(labelAnchor(100, 0, 200, 20)).toBe('middle');
  });
});

describe('line paths', () => {
  const p = (x: number, y: number) => ({ x, y });

  it('splits a series at nulls', () => {
    // Arrange
    const points = [p(0, 1), p(1, 2), null, p(3, 4), null, null, p(6, 7), p(7, 8)];

    // Act
    const segments = lineSegments(points);

    // Assert
    expect(segments).toEqual([[p(0, 1), p(1, 2)], [p(3, 4)], [p(6, 7), p(7, 8)]]);
  });

  it('builds a path that breaks on gaps instead of dropping to zero', () => {
    // Arrange
    const points = [p(0, 10), p(10, 20), null, p(30, 5), p(40, 6.256)];

    // Act
    const d = linePath(points);

    // Assert
    expect(d).toBe('M0,10L10,20M30,5L40,6.26');
  });

  it('draws nothing for lone points and reports them for markers', () => {
    // Arrange
    const points = [null, p(1, 1), null, p(3, 3), p(4, 4)];

    // Act + Assert
    expect(linePath([p(1, 1)])).toBe('');
    expect(isolatedPoints(points)).toEqual([p(1, 1)]);
  });

  it('returns an empty path for an all-null series', () => {
    expect(linePath([null, null])).toBe('');
    expect(lineSegments([])).toEqual([]);
  });
});

describe('columnPath', () => {
  it('rounds the data end and keeps the baseline square', () => {
    // Arrange + Act
    const d = columnPath(10, 20, 12, 80);

    // Assert
    expect(d).toBe('M10,100V24A4,4 0 0 1 14,20H18A4,4 0 0 1 22,24V100Z');
  });

  it('shrinks the radius for very short or narrow columns', () => {
    expect(columnPath(0, 0, 2, 2)).toBe('M0,2V1A1,1 0 0 1 1,0H1A1,1 0 0 1 2,1V2Z');
    expect(columnPath(0, 98, 10, 2)).toContain('A2,2');
  });

  it('draws nothing for zero-size columns', () => {
    expect(columnPath(0, 0, 0, 10)).toBe('');
    expect(columnPath(0, 0, 10, 0)).toBe('');
  });
});
