/**
 * Canvas painting for the knowledge graph. Colours come only from CSS custom properties (read at
 * runtime so light/dark themes both work); series colours fill nodes, text always uses ink tokens.
 */
import { FAMILY_COLOR_VARS, FAMILY_ORDER, shouldLabelFacts, worldToScreen, type Family, type Size, type View } from './graph-math';
import type { SimLink, SimNode } from './graph-sim';

export interface GraphPalette {
  readonly families: Readonly<Record<Family, string>>;
  readonly ink: string;
  readonly inkMuted: string;
  /** Background the canvas sits on; used for node rings and text halos. */
  readonly surface: string;
  readonly link: string;
  readonly font: string;
}

export interface DrawState {
  readonly nodes: readonly SimNode[];
  readonly links: readonly SimLink[];
  readonly view: View;
  readonly size: Size;
  readonly dpr: number;
  readonly palette: GraphPalette;
  readonly hoveredId: string | null;
}

/** Surface-coloured ring drawn around every node, so overlapping nodes stay distinct. */
export const RING_PX = 2;
const HOVER_RING_PX = 2;
const LABEL_GAP_PX = 4;
const HALO_PX = 4;
const SHARED_DASH: readonly number[] = [3, 4];
const FONT_HUB = '600 12px';
const FONT_FACT = '500 11px';

export function readPalette(root: HTMLElement = document.documentElement): GraphPalette {
  const style = getComputedStyle(root);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const families = Object.fromEntries(FAMILY_ORDER.map((family) => [family, read(FAMILY_COLOR_VARS[family])])) as Record<Family, string>;
  return {
    families,
    ink: read('--ink'),
    inkMuted: read('--ink-muted'),
    surface: read('--surface-1'),
    link: read('--hairline-strong'),
    font: read('--font-display') || 'system-ui, sans-serif',
  };
}

function nodeFill(node: SimNode, palette: GraphPalette): string {
  return node.family ? palette.families[node.family] : palette.ink;
}

function drawLinks(ctx: CanvasRenderingContext2D, state: DrawState): void {
  ctx.strokeStyle = state.palette.link;
  ctx.lineWidth = 1;
  for (const link of state.links) {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    if (typeof source !== 'object' || typeof target !== 'object') continue;
    const a = worldToScreen({ x: source.x ?? 0, y: source.y ?? 0 }, state.view, state.size);
    const b = worldToScreen({ x: target.x ?? 0, y: target.y ?? 0 }, state.view, state.size);
    ctx.setLineDash(link.kind === 'category' ? [] : [...SHARED_DASH]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawNodes(ctx: CanvasRenderingContext2D, state: DrawState): void {
  const { palette, view, size } = state;
  for (const node of state.nodes) {
    const p = worldToScreen({ x: node.x ?? 0, y: node.y ?? 0 }, view, size);
    const r = node.radius * view.k;
    if (node.id === state.hoveredId) circle(ctx, p.x, p.y, r + RING_PX + HOVER_RING_PX, palette.ink);
    circle(ctx, p.x, p.y, r + RING_PX, palette.surface);
    circle(ctx, p.x, p.y, r, nodeFill(node, palette));
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, palette: GraphPalette): void {
  ctx.lineWidth = HALO_PX;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.surface;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function drawLabels(ctx: CanvasRenderingContext2D, state: DrawState): void {
  const { palette, view, size } = state;
  const labelFacts = shouldLabelFacts(view.k);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const node of state.nodes) {
    const hovered = node.id === state.hoveredId;
    if (node.kind === 'fact' && !labelFacts && !hovered) continue;
    const p = worldToScreen({ x: node.x ?? 0, y: node.y ?? 0 }, view, size);
    const y = p.y + node.radius * view.k + RING_PX + LABEL_GAP_PX;
    ctx.font = `${node.kind === 'fact' ? FONT_FACT : FONT_HUB} ${palette.font}`;
    const colour = node.kind === 'fact' && !hovered ? palette.inkMuted : palette.ink;
    drawLabel(ctx, node.label, p.x, y, colour, palette);
  }
}

/** Paints one frame. Everything is drawn in CSS pixels; the device-pixel ratio is applied once. */
export function drawGraph(ctx: CanvasRenderingContext2D, state: DrawState): void {
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.clearRect(0, 0, state.size.width, state.size.height);
  drawLinks(ctx, state);
  drawNodes(ctx, state);
  drawLabels(ctx, state);
}
