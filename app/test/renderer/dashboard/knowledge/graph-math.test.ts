import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '@shared/types';
import {
  DEFAULT_VIEW, FIT_MAX_ZOOM, MAX_ZOOM, MIN_ZOOM, clampZoom, factCount, familyCategories, familyCounts, familyOf, fitView,
  graphSummary, hitTest, nodeRadius, panBy, screenToWorld, shouldLabelFacts, wheelFactor, worldToScreen, zoomAt,
} from '../../../../src/renderer/dashboard/pages/knowledge/graph-math';

const SIZE = { width: 800, height: 400 };

describe('families', () => {
  it('maps health, care and life categories to their families', () => {
    // Arrange + Act + Assert
    expect(['symptom', 'diagnosis', 'treatment', 'medication'].map((c) => familyOf(c as never))).toEqual(['health', 'health', 'health', 'health']);
    expect(familyOf('appointment')).toBe('care');
    expect(familyOf('care-team')).toBe('care');
    expect(['goal', 'feeling', 'preference', 'person', 'other'].every((c) => familyOf(c as never) === 'life')).toBe(true);
  });

  it('lists each family\'s categories in FACT_CATEGORIES order', () => {
    // Arrange + Act + Assert
    expect(familyCategories('health')).toEqual(['symptom', 'medication', 'diagnosis', 'treatment']);
    expect(familyCategories('care')).toEqual(['appointment', 'care-team']);
    expect(familyCategories('life')).toEqual(['goal', 'feeling', 'preference', 'person', 'other']);
  });
});

describe('transforms', () => {
  it('puts the world origin at the canvas centre in the default view', () => {
    // Arrange + Act
    const p = worldToScreen({ x: 0, y: 0 }, DEFAULT_VIEW, SIZE);

    // Assert
    expect(p).toEqual({ x: 400, y: 200 });
  });

  it('round-trips world → screen → world for any view', () => {
    // Arrange
    const view = { k: 1.7, panX: -35, panY: 12 };
    const world = { x: 42, y: -17 };

    // Act
    const back = screenToWorld(worldToScreen(world, view, SIZE), view, SIZE);

    // Assert
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });

  it('pans by screen pixels without changing zoom', () => {
    // Arrange + Act
    const view = panBy({ k: 2, panX: 10, panY: 10 }, 5, -20);

    // Assert
    expect(view).toEqual({ k: 2, panX: 15, panY: -10 });
  });
});

describe('zoom', () => {
  it('clamps zoom to the allowed range and repairs bad numbers', () => {
    // Arrange + Act + Assert
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(1.2)).toBe(1.2);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(-3)).toBe(1);
  });

  it('keeps the world point under the anchor fixed while zooming', () => {
    // Arrange
    const view = { k: 1, panX: 20, panY: -10 };
    const anchor = { x: 600, y: 120 };
    const before = screenToWorld(anchor, view, SIZE);

    // Act
    const zoomed = zoomAt(view, SIZE, anchor, 2);
    const after = screenToWorld(anchor, zoomed, SIZE);

    // Assert
    expect(zoomed.k).toBe(2);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('stops at the zoom limits', () => {
    // Arrange + Act
    const zoomed = zoomAt({ k: 2.9, panX: 0, panY: 0 }, SIZE, { x: 400, y: 200 }, 4);

    // Assert
    expect(zoomed.k).toBe(MAX_ZOOM);
  });

  it('zooms in for wheel-up and out for wheel-down', () => {
    // Arrange + Act + Assert
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
  });

  it('labels facts only when zoomed in', () => {
    // Arrange + Act + Assert
    expect(shouldLabelFacts(1)).toBe(false);
    expect(shouldLabelFacts(1.5)).toBe(true);
  });
});

describe('fitView', () => {
  it('centres the content and never zooms past the fit maximum', () => {
    // Arrange
    const circles = [{ x: 10, y: 10, radius: 5 }, { x: 30, y: 20, radius: 5 }];

    // Act
    const view = fitView(circles, SIZE);

    // Assert
    expect(view.k).toBe(FIT_MAX_ZOOM);
    const centre = worldToScreen({ x: 20, y: 15 }, view, SIZE);
    expect(centre.x).toBeCloseTo(400);
    expect(centre.y).toBeCloseTo(200);
  });

  it('zooms out so wide content fits inside the padding', () => {
    // Arrange
    const circles = [{ x: -1000, y: 0, radius: 10 }, { x: 1000, y: 0, radius: 10 }];

    // Act
    const view = fitView(circles, SIZE, 40);

    // Assert
    expect(view.k).toBeCloseTo(Math.max(MIN_ZOOM, 720 / 2020));
  });

  it('falls back to the default view with nothing to fit', () => {
    // Arrange + Act + Assert
    expect(fitView([], SIZE)).toEqual(DEFAULT_VIEW);
    expect(fitView([{ x: 0, y: 0, radius: 4 }], { width: 0, height: 0 })).toEqual(DEFAULT_VIEW);
  });
});

describe('hitTest', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0, radius: 10 },
    { id: 'b', x: 15, y: 0, radius: 10 },
    { id: 'c', x: 100, y: 100, radius: 6 },
  ];

  it('returns the nearest node whose circle contains the point', () => {
    // Arrange + Act + Assert
    expect(hitTest(nodes, { x: 9, y: 0 }, 1, 0)?.id).toBe('b');
    expect(hitTest(nodes, { x: 2, y: 1 }, 1, 0)?.id).toBe('a');
  });

  it('returns null when nothing is in reach', () => {
    // Arrange + Act + Assert
    expect(hitTest(nodes, { x: 60, y: 60 }, 1, 0)).toBeNull();
  });

  it('adds a screen-space slop that shrinks in world units as you zoom in', () => {
    // Arrange
    const point = { x: 100, y: 112 };

    // Act
    const zoomedOut = hitTest(nodes, point, 1, 8);
    const zoomedIn = hitTest(nodes, point, 4, 8);

    // Assert
    expect(zoomedOut?.id).toBe('c');
    expect(zoomedIn).toBeNull();
  });

  it('treats missing coordinates as the origin', () => {
    // Arrange + Act + Assert
    expect(hitTest([{ id: 'z', radius: 5 }], { x: 1, y: 1 }, 1, 0)?.id).toBe('z');
  });
});

describe('node sizes', () => {
  it('sizes "You" largest, hubs by fact count (capped), pinned facts larger', () => {
    // Arrange + Act + Assert
    expect(nodeRadius({ kind: 'self', weight: 20 })).toBe(18);
    expect(nodeRadius({ kind: 'category', weight: 2 })).toBeCloseTo(12.6);
    expect(nodeRadius({ kind: 'category', weight: 100 })).toBe(17);
    expect(nodeRadius({ kind: 'fact', weight: 1 })).toBe(6);
    expect(nodeRadius({ kind: 'fact', weight: 2 })).toBe(8);
  });
});

describe('graphSummary', () => {
  const graph: KnowledgeGraph = {
    nodes: [
      { id: 'self', label: 'You', kind: 'self', category: null, weight: 4 },
      { id: 'cat:medication', label: 'medication', kind: 'category', category: 'medication', weight: 2 },
      { id: 'cat:person', label: 'person', kind: 'category', category: 'person', weight: 1 },
      { id: 'f1', label: 'A', kind: 'fact', category: 'medication', weight: 1 },
      { id: 'f2', label: 'B', kind: 'fact', category: 'medication', weight: 1 },
      { id: 'f3', label: 'C', kind: 'fact', category: 'symptom', weight: 1 },
      { id: 'f4', label: 'D', kind: 'fact', category: 'person', weight: 1 },
    ],
    links: [],
  };

  it('counts facts per family, skipping families with none', () => {
    // Arrange + Act + Assert
    expect(familyCounts(graph)).toEqual([{ family: 'health', count: 3 }, { family: 'life', count: 1 }]);
    expect(factCount(graph)).toBe(4);
  });

  it('summarises groups and facts, and points to the Facts tab', () => {
    // Arrange + Act
    const summary = graphSummary(graph);

    // Assert
    expect(summary).toBe('Map of what Leafy remembers. 2 groups, 4 facts: Health 3, Life 1. The Facts tab lists every fact.');
  });

  it('reads sensibly for an empty graph', () => {
    // Arrange + Act
    const summary = graphSummary({ nodes: [], links: [] });

    // Assert
    expect(summary).toBe('Map of what Leafy remembers. 0 groups, 0 facts. The Facts tab lists every fact.');
  });
});
