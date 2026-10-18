// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildGraph } from '../../../../src/renderer/lib/mock/handlers-content';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { fitView, worldToScreen } from '../../../../src/renderer/dashboard/pages/knowledge/graph-math';
import { buildSimGraph, createSimulation, settle } from '../../../../src/renderer/dashboard/pages/knowledge/graph-sim';
import { setupBridge } from '../helpers';
import { recordingContext } from './canvas-fake';
import { renderKnowledge, renderWithAppearance, resetRootAttributes } from './render-knowledge';

const CANVAS_SIZE = { width: 800, height: 480 };
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalRect = HTMLCanvasElement.prototype.getBoundingClientRect;

function stubCanvas(): ReturnType<typeof recordingContext> {
  const rec = recordingContext();
  HTMLCanvasElement.prototype.getContext = (() => rec.ctx) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, right: CANVAS_SIZE.width, bottom: CANVAS_SIZE.height, ...CANVAS_SIZE, toJSON: () => ({}) }) as DOMRect;
  return rec;
}

/** Where the page will have drawn a fact: same deterministic layout + fit the component uses. */
function screenPositionOf(bridge: MockBridge, label: string) {
  const graph = buildSimGraph(buildGraph(bridge.getState().facts));
  settle(createSimulation(graph));
  const view = fitView(graph.nodes, CANVAS_SIZE);
  const node = graph.nodes.find((n) => n.label === label);
  return worldToScreen({ x: node?.x ?? 0, y: node?.y ?? 0 }, view, CANVAS_SIZE);
}

describe('KnowledgePage', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
    window.location.hash = '#/knowledge';
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = originalRect;
    resetRootAttributes();
  });

  it('opens on Facts, grouped by category with counts', async () => {
    // Arrange + Act
    renderKnowledge();

    // Assert
    expect(await screen.findByText('Oxaliplatin')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Medicines, 3 facts' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Facts' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches to the graph, shows the legend and a summarised canvas, and updates the hash', async () => {
    // Arrange
    renderKnowledge();
    await screen.findByText('Oxaliplatin');

    // Act
    fireEvent.click(screen.getByRole('tab', { name: 'Graph' }));

    // Assert
    const canvas = await screen.findByRole('img', { name: /3 groups, 17 facts: Health 7, Care 4, Life 6\. The Facts tab lists every fact\./ });
    expect(canvas.tagName).toBe('CANVAS');
    const legend = screen.getByRole('list', { name: 'Colour key' });
    expect(within(legend).getByText('Health')).toBeTruthy();
    expect(within(legend).getByText('Appointments, Care team')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeTruthy();
    expect(window.location.hash).toBe('#/knowledge/graph');
  });

  it('opens the tab named in the route', async () => {
    // Arrange + Act
    renderKnowledge('#/knowledge/dictionary');

    // Assert
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Dictionary' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows an empty state on the graph when nothing is known', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, facts: [] }));

    // Act
    renderKnowledge('#/knowledge/graph');

    // Assert
    expect(await screen.findByText('Nothing to map yet.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Map of what Leafy remembers/ })).toBeNull();
  });

  it('shows only the facts, with no tabs, in calm mode', async () => {
    // Arrange + Act
    renderWithAppearance(bridge, { calmMode: 'on' }, '#/knowledge/graph');

    // Assert
    expect(await screen.findByText('Oxaliplatin')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('img', { name: /Map of what Leafy remembers/ })).toBeNull();
  });

  it('settles and paints the graph before first paint under reduced motion, then stays still', async () => {
    // Arrange
    const rec = stubCanvas();

    // Act
    renderWithAppearance(bridge, { reduceMotion: 'on' }, '#/knowledge/graph');
    await screen.findByRole('img', { name: /17 facts/ });
    const drawnSoFar = rec.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Assert
    expect(rec.texts()).toEqual(expect.arrayContaining(['You', 'Medicines', 'Care team']));
    expect(rec.calls.length).toBe(drawnSoFar);
  });

  it('shows a tooltip on hover and opens the edit dialog when a fact is clicked', async () => {
    // Arrange
    stubCanvas();
    renderWithAppearance(bridge, { reduceMotion: 'on' }, '#/knowledge/graph');
    const canvas = await screen.findByRole('img', { name: /17 facts/ });
    const at = screenPositionOf(bridge, 'Oxaliplatin');
    const pointer = { clientX: at.x, clientY: at.y, button: 0, pointerId: 1 };

    // Act
    fireEvent.pointerMove(canvas, pointer);
    const tooltipText = await screen.findByText('Infusion every two weeks, on Tuesdays.');
    fireEvent.pointerDown(canvas, pointer);
    fireEvent.pointerUp(canvas, pointer);

    // Assert
    expect(tooltipText).toBeTruthy();
    const dialog = await screen.findByRole('dialog', { name: 'Edit fact' });
    expect((within(dialog).getByLabelText('Label') as HTMLInputElement).value).toBe('Oxaliplatin');
  });

  it('pans with a drag on empty space without opening anything', async () => {
    // Arrange
    stubCanvas();
    renderWithAppearance(bridge, { reduceMotion: 'on' }, '#/knowledge/graph');
    const canvas = await screen.findByRole('img', { name: /17 facts/ });

    // Act
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    // Assert
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks Zoom out unavailable at the smallest zoom', async () => {
    // Arrange
    renderKnowledge('#/knowledge/graph');
    await screen.findByRole('img', { name: /17 facts/ });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });

    // Act
    for (let i = 0; i < 10; i += 1) fireEvent.click(zoomOut);

    // Assert
    await waitFor(() => expect(zoomOut.getAttribute('aria-disabled')).toBe('true'));
  });
});
