import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph } from '@shared/types';
import {
  RELOAD_ALPHA, buildSimGraph, createSimulation, positionsOf, seedPositions, settle, type SimNode,
} from '../../../../src/renderer/dashboard/pages/knowledge/graph-sim';

const GRAPH: KnowledgeGraph = {
  nodes: [
    { id: 'self', label: 'You', kind: 'self', category: null, weight: 4 },
    { id: 'cat:medication', label: 'medication', kind: 'category', category: 'medication', weight: 2 },
    { id: 'cat:care-team', label: 'care-team', kind: 'category', category: 'care-team', weight: 1 },
    { id: 'cat:goal', label: 'goal', kind: 'category', category: 'goal', weight: 1 },
    { id: 'f1', label: 'Oxaliplatin', kind: 'fact', category: 'medication', weight: 2 },
    { id: 'f2', label: 'Vitamin D', kind: 'fact', category: 'medication', weight: 1 },
    { id: 'f3', label: 'Dr. Ellis', kind: 'fact', category: 'care-team', weight: 1 },
    { id: 'f4', label: 'Walk daily', kind: 'fact', category: 'goal', weight: 1 },
  ],
  links: [
    { source: 'self', target: 'cat:medication', kind: 'category' },
    { source: 'self', target: 'cat:care-team', kind: 'category' },
    { source: 'self', target: 'cat:goal', kind: 'category' },
    { source: 'cat:medication', target: 'f1', kind: 'category' },
    { source: 'cat:medication', target: 'f2', kind: 'category' },
    { source: 'cat:care-team', target: 'f3', kind: 'category' },
    { source: 'cat:goal', target: 'f4', kind: 'category' },
    { source: 'f1', target: 'f3', kind: 'shared-term' },
    { source: 'f1', target: 'missing', kind: 'co-mention' },
    { source: 'f2', target: 'f2', kind: 'co-mention' },
  ],
};

const byId = (nodes: readonly SimNode[], id: string) => nodes.find((n) => n.id === id) as SimNode;

describe('buildSimGraph', () => {
  it('labels hubs with plain category names and pins "You" at the origin', () => {
    // Arrange + Act
    const { nodes } = buildSimGraph(GRAPH);

    // Assert
    expect(byId(nodes, 'cat:care-team').label).toBe('Care team');
    expect(byId(nodes, 'cat:medication').family).toBe('health');
    expect(byId(nodes, 'f3').family).toBe('care');
    const self = byId(nodes, 'self');
    expect([self.x, self.y, self.fx, self.fy]).toEqual([0, 0, 0, 0]);
    expect(self.family).toBeNull();
  });

  it('drops links to missing nodes and self-links', () => {
    // Arrange + Act
    const { links } = buildSimGraph(GRAPH);

    // Assert
    expect(links).toHaveLength(8);
    expect(links.some((l) => l.target === 'missing')).toBe(false);
  });

  it('prefers previous positions over seeded ones', () => {
    // Arrange
    const previous = new Map([['f2', { x: 321, y: -54 }]]);

    // Act
    const { nodes } = buildSimGraph(GRAPH, previous);

    // Assert
    expect([byId(nodes, 'f2').x, byId(nodes, 'f2').y]).toEqual([321, -54]);
  });

  it('never mutates the graph it was given, even after simulating', () => {
    // Arrange
    const snapshot = JSON.stringify(GRAPH);

    // Act
    const simulation = createSimulation(buildSimGraph(GRAPH));
    settle(simulation);

    // Assert
    expect(JSON.stringify(GRAPH)).toBe(snapshot);
  });
});

describe('seedPositions', () => {
  it('is deterministic and places hubs on a ring with facts beyond them', () => {
    // Arrange + Act
    const a = seedPositions(GRAPH);
    const b = seedPositions(GRAPH);

    // Assert
    expect([...a.entries()]).toEqual([...b.entries()]);
    const hub = a.get('cat:medication') ?? { x: 0, y: 0 };
    const leaf = a.get('f1') ?? { x: 0, y: 0 };
    expect(Math.hypot(hub.x, hub.y)).toBeCloseTo(120);
    expect(Math.hypot(leaf.x, leaf.y)).toBeGreaterThan(Math.hypot(hub.x, hub.y));
  });
});

describe('simulation', () => {
  it('is created stopped, so nothing animates until asked', async () => {
    // Arrange
    const simulation = createSimulation(buildSimGraph(GRAPH));
    const onTick = vi.fn();
    simulation.on('tick', onTick);

    // Act
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Assert
    expect(onTick).not.toHaveBeenCalled();
    simulation.on('tick', null);
  });

  it('settles synchronously to rest without tick events', () => {
    // Arrange
    const graph = buildSimGraph(GRAPH);
    const simulation = createSimulation(graph);
    const onTick = vi.fn();
    simulation.on('tick', onTick);

    // Act
    settle(simulation);

    // Assert
    expect(simulation.alpha()).toBeLessThan(simulation.alphaMin());
    expect(onTick).not.toHaveBeenCalled();
    const self = byId(graph.nodes, 'self');
    expect([self.x, self.y]).toEqual([0, 0]);
    expect(graph.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it('keeps linked facts nearer their hub than unrelated hubs', () => {
    // Arrange
    const graph = buildSimGraph(GRAPH);

    // Act
    settle(createSimulation(graph));
    const at = positionsOf(graph.nodes);
    const distance = (a: string, b: string) => {
      const p = at.get(a) ?? { x: 0, y: 0 };
      const q = at.get(b) ?? { x: 0, y: 0 };
      return Math.hypot(p.x - q.x, p.y - q.y);
    };

    // Assert
    expect(distance('f4', 'cat:goal')).toBeLessThan(distance('f4', 'cat:medication'));
  });

  it('settles a reload from previous positions in fewer ticks', () => {
    // Arrange
    const first = buildSimGraph(GRAPH);
    settle(createSimulation(first));
    const reload = createSimulation(buildSimGraph(GRAPH, positionsOf(first.nodes)), RELOAD_ALPHA);

    // Act
    settle(reload);

    // Assert
    expect(reload.alpha()).toBeLessThan(reload.alphaMin());
  });
});
