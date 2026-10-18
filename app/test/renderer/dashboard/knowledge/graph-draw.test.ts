// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { drawGraph, readPalette, type GraphPalette } from '../../../../src/renderer/dashboard/pages/knowledge/graph-draw';
import type { SimLink, SimNode } from '../../../../src/renderer/dashboard/pages/knowledge/graph-sim';
import { recordingContext } from './canvas-fake';

const PALETTE: GraphPalette = {
  families: { health: 'h-colour', care: 'c-colour', life: 'l-colour' },
  ink: 'ink',
  inkMuted: 'ink-muted',
  surface: 'surface',
  link: 'link',
  font: 'Inter',
};

const SELF: SimNode = { id: 'self', label: 'You', kind: 'self', category: null, family: null, radius: 18, x: 0, y: 0 };
const HUB: SimNode = { id: 'cat:medication', label: 'Medicines', kind: 'category', category: 'medication', family: 'health', radius: 12, x: 100, y: 0 };
const FACT: SimNode = { id: 'f1', label: 'Oxaliplatin', kind: 'fact', category: 'medication', family: 'health', radius: 6, x: 150, y: 10 };
const LINKS: SimLink[] = [
  { source: SELF, target: HUB, kind: 'category' },
  { source: HUB, target: FACT, kind: 'category' },
];

function state(k: number, hoveredId: string | null = null) {
  return {
    nodes: [SELF, HUB, FACT],
    links: LINKS,
    view: { k, panX: 0, panY: 0 },
    size: { width: 600, height: 400 },
    dpr: 2,
    palette: PALETTE,
    hoveredId,
  };
}

describe('drawGraph', () => {
  it('labels "You" and hubs but not facts at normal zoom', () => {
    // Arrange
    const rec = recordingContext();

    // Act
    drawGraph(rec.ctx, state(1));

    // Assert
    expect(rec.texts()).toEqual(['You', 'Medicines']);
  });

  it('labels facts when zoomed in, and the hovered fact at any zoom', () => {
    // Arrange
    const zoomed = recordingContext();
    const hovered = recordingContext();

    // Act
    drawGraph(zoomed.ctx, state(2));
    drawGraph(hovered.ctx, state(1, 'f1'));

    // Assert
    expect(zoomed.texts()).toContain('Oxaliplatin');
    expect(hovered.texts()).toContain('Oxaliplatin');
  });

  it('applies the device-pixel ratio once and draws links, rings and nodes', () => {
    // Arrange
    const rec = recordingContext();

    // Act
    drawGraph(rec.ctx, state(1));

    // Assert
    expect(rec.calls[0]).toEqual({ name: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
    expect(rec.calls.filter((c) => c.name === 'lineTo')).toHaveLength(2);
    // Each node: a surface ring plus its fill.
    expect(rec.calls.filter((c) => c.name === 'arc')).toHaveLength(6);
  });

  it('draws a hover ring in ink around the hovered node', () => {
    // Arrange
    const rec = recordingContext();

    // Act
    drawGraph(rec.ctx, state(1, 'cat:medication'));

    // Assert
    expect(rec.calls.filter((c) => c.name === 'arc')).toHaveLength(7);
  });
});

describe('readPalette', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('reads family colours and ink tokens from CSS custom properties', () => {
    // Arrange
    const root = document.documentElement;
    root.style.setProperty('--viz-1', 'blue');
    root.style.setProperty('--viz-2', 'orange');
    root.style.setProperty('--viz-3', 'teal');
    root.style.setProperty('--ink', 'white');

    // Act
    const palette = readPalette(root);

    // Assert
    expect(palette.families).toEqual({ health: 'blue', care: 'orange', life: 'teal' });
    expect(palette.ink).toBe('white');
    expect(palette.font).toBeTruthy();
  });
});
