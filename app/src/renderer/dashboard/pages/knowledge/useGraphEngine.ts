/**
 * The imperative side of the knowledge graph: owns the d3-force simulation, the canvas, the view
 * (pan/zoom) and pointer gestures. Per-frame state lives in a ref so animation never re-renders React;
 * only the hovered node and the zoom level (for the tooltip and the zoom buttons) are React state.
 *
 * Reduced motion: the layout is settled synchronously in a layout effect (before first paint) and
 * never animates. Otherwise the simulation animates and cools to rest on its own.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { KnowledgeGraph } from '@shared/types';
import {
  DEFAULT_VIEW, ZOOM_STEP, fitView, hitTest, panBy, screenToWorld, wheelFactor, worldToScreen, zoomAt,
  type Point, type Size, type View,
} from './graph-math';
import {
  DRAG_ALPHA_TARGET, RELOAD_ALPHA, buildSimGraph, createSimulation, positionsOf, settle,
  type KnowledgeSimulation, type SimLink, type SimNode,
} from './graph-sim';
import { RING_PX, drawGraph, readPalette, type GraphPalette } from './graph-draw';

/** Pointer travel (px) below which a press on a fact counts as a click, not a drag. */
const CLICK_SLOP_PX = 4;

type Gesture =
  | { readonly type: 'pan'; readonly start: Point; readonly startView: View; readonly moved: boolean }
  | { readonly type: 'node'; readonly node: SimNode; readonly start: Point; readonly moved: boolean };

/** Mutable per-frame state (canvas work is imperative by nature). */
interface Engine {
  size: Size;
  dpr: number;
  view: View;
  nodes: SimNode[];
  links: SimLink[];
  sim: KnowledgeSimulation | null;
  palette: GraphPalette | null;
  hoveredId: string | null;
  positions: ReadonlyMap<string, Point>;
  gesture: Gesture | null;
  laidOut: boolean;
}

export interface HoverInfo {
  readonly id: string;
  readonly kind: SimNode['kind'];
  readonly label: string;
  /** Node centre in CSS px relative to the canvas. */
  readonly x: number;
  readonly y: number;
  /** On-screen radius plus ring, so the tooltip clears the node. */
  readonly reach: number;
  readonly canvasWidth: number;
}

type CanvasPointerEvent = ReactPointerEvent<HTMLCanvasElement>;

export interface GraphEngine {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly hover: HoverInfo | null;
  readonly zoom: number;
  readonly onPointerDown: (event: CanvasPointerEvent) => void;
  readonly onPointerMove: (event: CanvasPointerEvent) => void;
  readonly onPointerUp: (event: CanvasPointerEvent) => void;
  readonly onPointerCancel: (event: CanvasPointerEvent) => void;
  readonly onPointerLeave: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetView: () => void;
}

export interface GraphEngineOptions {
  readonly graph: KnowledgeGraph;
  readonly reduceMotion: boolean;
  /** A fact node was clicked (pressed and released without dragging). */
  readonly onSelect: (id: string) => void;
}

function createEngine(): Engine {
  return {
    size: { width: 1, height: 1 }, dpr: 1, view: DEFAULT_VIEW, nodes: [], links: [], sim: null, palette: null,
    hoveredId: null, positions: new Map(), gesture: null, laidOut: false,
  };
}

function measureCanvas(canvas: HTMLCanvasElement): { readonly size: Size; readonly dpr: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const size = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  const pixelWidth = Math.round(size.width * dpr);
  const pixelHeight = Math.round(size.height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  return { size, dpr };
}

function localPoint(canvas: HTMLCanvasElement | null, event: { readonly clientX: number; readonly clientY: number }): Point {
  const rect = canvas?.getBoundingClientRect();
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
}

function hoverInfo(node: SimNode, engine: Engine): HoverInfo {
  const p = worldToScreen({ x: node.x ?? 0, y: node.y ?? 0 }, engine.view, engine.size);
  return { id: node.id, kind: node.kind, label: node.label, x: p.x, y: p.y, reach: node.radius * engine.view.k + RING_PX, canvasWidth: engine.size.width };
}

function dragNodeTo(node: SimNode, world: Point, immediate: boolean): void {
  node.fx = world.x;
  node.fy = world.y;
  if (!immediate) return;
  node.x = world.x;
  node.y = world.y;
}

/** Builds the simulation for each graph; settles it before paint (reduced motion) or animates it. */
function useSimulation(engine: RefObject<Engine>, graph: KnowledgeGraph, reduceMotion: boolean, draw: () => void, measure: () => void, applyView: (view: View) => void): void {
  useLayoutEffect(() => {
    const e = engine.current;
    const simGraph = buildSimGraph(graph, e.positions);
    const simulation = createSimulation(simGraph, e.positions.size > 0 ? RELOAD_ALPHA : 1);
    e.nodes = simGraph.nodes;
    e.links = simGraph.links;
    e.sim = simulation;
    measure();
    if (reduceMotion) {
      settle(simulation);
      if (!e.laidOut) applyView(fitView(e.nodes, e.size));
    } else {
      simulation.on('tick', draw).restart();
    }
    e.laidOut = true;
    draw();
    return () => {
      simulation.on('tick', null).stop();
      e.positions = positionsOf(simGraph.nodes);
      e.sim = null;
    };
  }, [engine, graph, reduceMotion, draw, measure, applyView]);
}

/** Wheel zoom (non-passive, so the page doesn't scroll), resize, and theme changes. */
function useCanvasObservers(canvasRef: RefObject<HTMLCanvasElement | null>, engine: RefObject<Engine>, draw: () => void, measure: () => void, applyView: (view: View) => void): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const e = engine.current;
      applyView(zoomAt(e.view, e.size, localPoint(canvas, event), wheelFactor(event.deltaY)));
    };
    const resize = new ResizeObserver(() => {
      measure();
      draw();
    });
    const theme = new MutationObserver(() => {
      engine.current.palette = readPalette();
      draw();
    });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    resize.observe(canvas);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      resize.disconnect();
      theme.disconnect();
    };
  }, [canvasRef, engine, draw, measure, applyView]);
}

export function useGraphEngine({ graph, reduceMotion, onSelect }: GraphEngineOptions): GraphEngine {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine>(createEngine());
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_VIEW.k);
  const selectRef = useRef(onSelect);
  const reduceRef = useRef(reduceMotion);
  useEffect(() => {
    selectRef.current = onSelect;
    reduceRef.current = reduceMotion;
  }, [onSelect, reduceMotion]);

  const draw = useCallback(() => {
    const e = engine.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const palette = e.palette ?? readPalette();
    e.palette = palette;
    drawGraph(ctx, { nodes: e.nodes, links: e.links, view: e.view, size: e.size, dpr: e.dpr, palette, hoveredId: e.hoveredId });
  }, []);

  const measure = useCallback(() => {
    if (!canvasRef.current) return;
    const { size, dpr } = measureCanvas(canvasRef.current);
    engine.current.size = size;
    engine.current.dpr = dpr;
  }, []);

  const setHovered = useCallback((node: SimNode | null) => {
    const e = engine.current;
    if ((node?.id ?? null) === e.hoveredId) return;
    e.hoveredId = node?.id ?? null;
    setHover(node ? hoverInfo(node, e) : null);
    draw();
  }, [draw]);

  const applyView = useCallback((view: View) => {
    engine.current.view = view;
    setZoom(view.k);
    setHovered(null);
    draw();
  }, [draw, setHovered]);

  useSimulation(engine, graph, reduceMotion, draw, measure, applyView);
  useCanvasObservers(canvasRef, engine, draw, measure, applyView);

  const zoomBy = useCallback((factor: number) => {
    const e = engine.current;
    applyView(zoomAt(e.view, e.size, { x: e.size.width / 2, y: e.size.height / 2 }, factor));
  }, [applyView]);
  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);
  const resetView = useCallback(() => applyView(fitView(engine.current.nodes, engine.current.size)), [applyView]);

  const handlers = pointerHandlers({ canvasRef, engine, draw, setHovered, selectRef, reduceRef });
  return { canvasRef, hover, zoom, ...handlers, zoomIn, zoomOut, resetView };
}

interface PointerContext {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly engine: RefObject<Engine>;
  readonly draw: () => void;
  readonly setHovered: (node: SimNode | null) => void;
  readonly selectRef: RefObject<(id: string) => void>;
  readonly reduceRef: RefObject<boolean>;
}

/** Pan on empty space, drag nodes ("You" stays put), click a fact to select it, hover for details. */
function pointerHandlers({ canvasRef, engine, draw, setHovered, selectRef, reduceRef }: PointerContext) {
  const setCursor = (cursor: 'grab' | 'grabbing' | 'pointer') => {
    if (canvasRef.current) canvasRef.current.dataset.cursor = cursor;
  };
  const nodeAt = (p: Point): SimNode | null => {
    const e = engine.current;
    return hitTest(e.nodes, screenToWorld(p, e.view, e.size), e.view.k);
  };
  const hoverAt = (p: Point) => {
    const node = nodeAt(p);
    setHovered(node);
    setCursor(node?.kind === 'fact' ? 'pointer' : 'grab');
  };

  const onPointerDown = (event: CanvasPointerEvent) => {
    if (event.button !== 0) return;
    const e = engine.current;
    const start = localPoint(canvasRef.current, event);
    const node = nodeAt(start);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setHovered(null);
    setCursor('grabbing');
    if (node && node.kind !== 'self') {
      dragNodeTo(node, { x: node.x ?? 0, y: node.y ?? 0 }, false);
      e.gesture = { type: 'node', node, start, moved: false };
    } else {
      e.gesture = { type: 'pan', start, startView: e.view, moved: false };
    }
  };

  const onPointerMove = (event: CanvasPointerEvent) => {
    const e = engine.current;
    const p = localPoint(canvasRef.current, event);
    const gesture = e.gesture;
    if (!gesture) return hoverAt(p);
    const moved = gesture.moved || Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > CLICK_SLOP_PX;
    if (gesture.type === 'pan') {
      e.gesture = { ...gesture, moved };
      e.view = panBy(gesture.startView, p.x - gesture.start.x, p.y - gesture.start.y);
    } else {
      if (moved && !gesture.moved && !reduceRef.current) e.sim?.alphaTarget(DRAG_ALPHA_TARGET).restart();
      e.gesture = { ...gesture, moved };
      dragNodeTo(gesture.node, screenToWorld(p, e.view, e.size), reduceRef.current);
    }
    draw();
  };

  const finish = (event: CanvasPointerEvent, allowSelect: boolean) => {
    const e = engine.current;
    const gesture = e.gesture;
    e.gesture = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture?.type !== 'node') return hoverAt(localPoint(canvasRef.current, event));
    gesture.node.fx = null;
    gesture.node.fy = null;
    if (!reduceRef.current) e.sim?.alphaTarget(0);
    if (allowSelect && !gesture.moved && gesture.node.kind === 'fact') {
      setCursor('grab');
      selectRef.current(gesture.node.id);
      return undefined;
    }
    return hoverAt(localPoint(canvasRef.current, event));
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: CanvasPointerEvent) => finish(event, true),
    onPointerCancel: (event: CanvasPointerEvent) => finish(event, false),
    onPointerLeave: () => {
      if (!engine.current.gesture) setHovered(null);
    },
  };
}
