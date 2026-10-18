/**
 * d3-force set-up for the knowledge graph. "You" is pinned at the world origin; category hubs start
 * on a ring (grouped by family, in FACT_CATEGORIES order) and facts start just outside their hub.
 *
 * d3-force mutates node and link objects in place (x, y, vx, vy, source/target), so every build
 * makes fresh copies — the IPC data passed in is never touched.
 */
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import { FACT_CATEGORIES, type FactCategory, type GraphLink, type GraphNode, type KnowledgeGraph } from '@shared/types';
import { CATEGORY_NAMES } from './knowledge-model';
import { familyOf, nodeRadius, type Family, type Point } from './graph-math';

export interface SimNode extends SimulationNodeDatum {
  readonly id: string;
  readonly label: string;
  readonly kind: GraphNode['kind'];
  readonly category: FactCategory | null;
  readonly family: Family | null;
  readonly radius: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  readonly kind: GraphLink['kind'];
}

export type KnowledgeSimulation = Simulation<SimNode, SimLink>;

export interface SimGraph {
  readonly nodes: SimNode[];
  readonly links: SimLink[];
}

/** Alpha used when a reload starts from the previous layout, so it shifts gently instead of exploding. */
export const RELOAD_ALPHA = 0.3;
/** Alpha target while a node is being dragged (keeps the layout responsive), back to 0 on release. */
export const DRAG_ALPHA_TARGET = 0.3;

const HUB_RING = 120;
const FACT_RING = 48;
const FACT_SPREAD = 0.32;
const COLLIDE_GAP = 6;
const CENTRE_PULL = 0.04;
const RANDOM_SEED = 42;
const CHARGE = { self: -320, category: -260, fact: -70 } as const;
const LINK = {
  hub: { distance: 110, strength: 0.8 },
  category: { distance: 52, strength: 0.7 },
  'co-mention': { distance: 120, strength: 0.06 },
  'shared-term': { distance: 130, strength: 0.04 },
} as const;

function displayLabel(node: GraphNode): string {
  if (node.kind === 'self') return 'You';
  if (node.kind === 'category' && node.category) return CATEGORY_NAMES[node.category];
  return node.label;
}

function hubAngles(graph: KnowledgeGraph): Map<FactCategory, number> {
  const hubs = FACT_CATEGORIES.filter((category) => graph.nodes.some((n) => n.kind === 'category' && n.category === category));
  return new Map(hubs.map((category, i) => [category, (2 * Math.PI * i) / Math.max(1, hubs.length) - Math.PI / 2]));
}

/** Deterministic starting positions: hubs on a ring, facts fanned out just beyond their hub. */
export function seedPositions(graph: KnowledgeGraph): Map<string, Point> {
  const angles = hubAngles(graph);
  const factIndex = new Map<FactCategory, number>();
  const positions = new Map<string, Point>();
  for (const node of graph.nodes) {
    const angle = node.category ? angles.get(node.category) ?? 0 : 0;
    if (node.kind === 'self') {
      positions.set(node.id, { x: 0, y: 0 });
    } else if (node.kind === 'category') {
      positions.set(node.id, { x: Math.cos(angle) * HUB_RING, y: Math.sin(angle) * HUB_RING });
    } else {
      const index = node.category ? factIndex.get(node.category) ?? 0 : 0;
      if (node.category) factIndex.set(node.category, index + 1);
      const spread = angle + (index % 2 === 0 ? 1 : -1) * Math.ceil(index / 2) * FACT_SPREAD;
      const ring = HUB_RING + FACT_RING;
      positions.set(node.id, { x: Math.cos(spread) * ring, y: Math.sin(spread) * ring });
    }
  }
  return positions;
}

/** Fresh simulation nodes/links; `previous` positions (from an earlier layout) win over seeds. */
export function buildSimGraph(graph: KnowledgeGraph, previous: ReadonlyMap<string, Point> = new Map()): SimGraph {
  const seeds = seedPositions(graph);
  const nodes = graph.nodes.map((node): SimNode => {
    const start = previous.get(node.id) ?? seeds.get(node.id) ?? { x: 0, y: 0 };
    const base: SimNode = {
      id: node.id,
      label: displayLabel(node),
      kind: node.kind,
      category: node.category,
      family: node.category ? familyOf(node.category) : null,
      radius: nodeRadius(node),
      x: start.x,
      y: start.y,
    };
    return node.kind === 'self' ? { ...base, x: 0, y: 0, fx: 0, fy: 0 } : base;
  });
  const ids = new Set(nodes.map((node) => node.id));
  const links = graph.links
    .filter((link) => link.source !== link.target && ids.has(link.source) && ids.has(link.target))
    .map((link): SimLink => ({ source: link.source, target: link.target, kind: link.kind }));
  return { nodes, links };
}

function linkSpec(link: SimLink): { readonly distance: number; readonly strength: number } {
  const source = link.source as SimNode;
  const target = link.target as SimNode;
  if (link.kind === 'category' && (source.kind === 'self' || target.kind === 'self')) return LINK.hub;
  return LINK[link.kind];
}

/** Seeded pseudo-random source so d3's jiggle (for coincident nodes) is repeatable. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (1664525 * state + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** A configured simulation, returned STOPPED: callers either `settle()` it or `restart()` to animate. */
export function createSimulation(graph: SimGraph, alpha = 1): KnowledgeSimulation {
  return forceSimulation<SimNode, SimLink>(graph.nodes)
    .randomSource(seededRandom(RANDOM_SEED))
    .force(
      'link',
      forceLink<SimNode, SimLink>(graph.links)
        .id((node) => node.id)
        .distance((link) => linkSpec(link).distance)
        .strength((link) => linkSpec(link).strength),
    )
    .force('charge', forceManyBody<SimNode>().strength((node) => CHARGE[node.kind]))
    .force('collide', forceCollide<SimNode>().radius((node) => node.radius + COLLIDE_GAP))
    .force('x', forceX<SimNode>(0).strength(CENTRE_PULL))
    .force('y', forceY<SimNode>(0).strength(CENTRE_PULL))
    .alpha(alpha)
    .stop();
}

/** Runs the simulation to rest synchronously (no 'tick' events, no timers). */
export function settle(simulation: KnowledgeSimulation): void {
  simulation.stop();
  const maxTicks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
  for (let i = 0; i < maxTicks && simulation.alpha() >= simulation.alphaMin(); i += 1) simulation.tick();
}

export function positionsOf(nodes: readonly SimNode[]): Map<string, Point> {
  return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
}
