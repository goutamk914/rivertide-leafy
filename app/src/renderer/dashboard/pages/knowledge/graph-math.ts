/**
 * Pure maths for the knowledge graph: colour families, node sizes, world↔screen transforms,
 * zoom clamping, fit-to-content, hit-testing and the screen-reader summary. No DOM access.
 *
 * Coordinates: the world origin is "You". screen = centre(size) + pan + world × k.
 */
import { FACT_CATEGORIES, type FactCategory, type GraphNode, type KnowledgeGraph } from '@shared/types';
import { pluralize } from '../../../lib/format';

export type Family = 'health' | 'care' | 'life';
export const FAMILY_ORDER: readonly Family[] = ['health', 'care', 'life'];

const CATEGORY_FAMILY: Readonly<Record<FactCategory, Family>> = {
  symptom: 'health',
  diagnosis: 'health',
  treatment: 'health',
  medication: 'health',
  appointment: 'care',
  'care-team': 'care',
  goal: 'life',
  feeling: 'life',
  preference: 'life',
  person: 'life',
  other: 'life',
};

export const FAMILY_NAMES: Readonly<Record<Family, string>> = { health: 'Health', care: 'Care', life: 'Life' };

/** CSS custom properties validated (all pairs, CVD-safe) for the three families. */
export const FAMILY_COLOR_VARS: Readonly<Record<Family, string>> = { health: '--viz-1', care: '--viz-2', life: '--viz-3' };

export function familyOf(category: FactCategory): Family {
  return CATEGORY_FAMILY[category];
}

export function familyCategories(family: Family): FactCategory[] {
  return FACT_CATEGORIES.filter((category) => CATEGORY_FAMILY[category] === family);
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface View {
  readonly k: number;
  readonly panX: number;
  readonly panY: number;
}

export const DEFAULT_VIEW: View = { k: 1, panX: 0, panY: 0 };
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 3;
/** Fit never zooms in past this, so a tiny graph doesn't fill the screen with giant dots. */
export const FIT_MAX_ZOOM = 1.4;
export const ZOOM_STEP = 1.25;
/** Fact labels appear at or above this zoom (hubs and "You" are always labelled). */
export const FACT_LABEL_ZOOM = 1.5;
/** Extra screen pixels around a node that still count as a hit (comfortable pointer targets). */
export const HIT_SLOP_PX = 8;
const FIT_PADDING_PX = 40;

const RADIUS = { self: 18, category: 11, fact: 6, pinnedFact: 8 } as const;
const CATEGORY_RADIUS_PER_FACT = 0.8;
const CATEGORY_RADIUS_MAX = 17;

export function nodeRadius(node: Pick<GraphNode, 'kind' | 'weight'>): number {
  if (node.kind === 'self') return RADIUS.self;
  if (node.kind === 'category') return Math.min(CATEGORY_RADIUS_MAX, RADIUS.category + node.weight * CATEGORY_RADIUS_PER_FACT);
  return node.weight > 1 ? RADIUS.pinnedFact : RADIUS.fact;
}

export function clampZoom(k: number): number {
  if (!Number.isFinite(k) || k <= 0) return DEFAULT_VIEW.k;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

export function worldToScreen(point: Point, view: View, size: Size): Point {
  return { x: size.width / 2 + view.panX + point.x * view.k, y: size.height / 2 + view.panY + point.y * view.k };
}

export function screenToWorld(point: Point, view: View, size: Size): Point {
  return { x: (point.x - size.width / 2 - view.panX) / view.k, y: (point.y - size.height / 2 - view.panY) / view.k };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

/** Zooms by `factor`, keeping the world point under `anchor` (screen px) where it is. */
export function zoomAt(view: View, size: Size, anchor: Point, factor: number): View {
  const k = clampZoom(view.k * factor);
  const world = screenToWorld(anchor, view, size);
  return { k, panX: anchor.x - size.width / 2 - world.x * k, panY: anchor.y - size.height / 2 - world.y * k };
}

/** Wheel delta (px) → zoom factor; up zooms in. */
export function wheelFactor(deltaY: number): number {
  const WHEEL_SENSITIVITY = 0.0015;
  return Math.exp(-deltaY * WHEEL_SENSITIVITY);
}

export interface Circle {
  readonly x?: number;
  readonly y?: number;
  readonly radius: number;
}

/** A view that shows every circle with some padding, centred, never past FIT_MAX_ZOOM. */
export function fitView(circles: readonly Circle[], size: Size, padding = FIT_PADDING_PX): View {
  if (circles.length === 0 || size.width <= 0 || size.height <= 0) return DEFAULT_VIEW;
  const xs = circles.flatMap((c) => [(c.x ?? 0) - c.radius, (c.x ?? 0) + c.radius]);
  const ys = circles.flatMap((c) => [(c.y ?? 0) - c.radius, (c.y ?? 0) + c.radius]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const availableW = Math.max(1, size.width - padding * 2);
  const availableH = Math.max(1, size.height - padding * 2);
  const k = clampZoom(Math.min(availableW / Math.max(1, maxX - minX), availableH / Math.max(1, maxY - minY), FIT_MAX_ZOOM));
  return { k, panX: -((minX + maxX) / 2) * k, panY: -((minY + maxY) / 2) * k };
}

export interface HitTarget extends Circle {
  readonly id: string;
}

/** The nearest node whose circle (plus a screen-space slop) contains `world`, or null. */
export function hitTest<T extends HitTarget>(nodes: readonly T[], world: Point, k: number, slopPx = HIT_SLOP_PX): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const distance = Math.hypot((node.x ?? 0) - world.x, (node.y ?? 0) - world.y);
    if (distance <= node.radius + slopPx / k && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

export function shouldLabelFacts(k: number): boolean {
  return k >= FACT_LABEL_ZOOM;
}

export interface FamilyCount {
  readonly family: Family;
  readonly count: number;
}

/** Fact counts per family (families with no facts left out), in FAMILY_ORDER. */
export function familyCounts(graph: KnowledgeGraph): FamilyCount[] {
  const facts = graph.nodes.filter((node) => node.kind === 'fact' && node.category !== null);
  return FAMILY_ORDER.map((family) => ({
    family,
    count: facts.filter((node) => node.category !== null && familyOf(node.category) === family).length,
  })).filter((entry) => entry.count > 0);
}

export function factCount(graph: KnowledgeGraph): number {
  return graph.nodes.filter((node) => node.kind === 'fact').length;
}

/** "3 groups, 17 facts: Health 7, Care 4, Life 6. The Facts tab lists every fact." */
export function graphSummary(graph: KnowledgeGraph): string {
  const counts = familyCounts(graph);
  const parts = counts.map((entry) => `${FAMILY_NAMES[entry.family]} ${entry.count}`).join(', ');
  const head = `Map of what Leafy remembers. ${pluralize(counts.length, 'group')}, ${pluralize(factCount(graph), 'fact')}`;
  return `${head}${parts ? `: ${parts}` : ''}. The Facts tab lists every fact.`;
}
