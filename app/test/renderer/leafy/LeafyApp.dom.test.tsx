// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeafyApp } from '../../../src/renderer/leafy/LeafyApp';
import { IDLE_SNAPSHOT } from '../../../src/renderer/lib/hooks/useVoiceSnapshot';
import { calledWith, setupOverlayBridge, type OverlayBridge } from '../hooks/overlay-dom';

describe('Leafy window', () => {
  let ctx: OverlayBridge;

  beforeEach(() => {
    ctx = setupOverlayBridge();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 280 });
  });

  afterEach(() => cleanup());

  it('greets once settings arrive and offers labelled toolbar buttons', async () => {
    // Arrange + Act
    render(<LeafyApp />);

    // Assert
    expect(await screen.findByText('Hi there')).toBeTruthy();
    expect(screen.getByText(/Press ⇧⌘L/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Talk to Leafy' }).getAttribute('aria-keyshortcuts')).toBe('⇧⌘L');
    expect(screen.getByRole('button', { name: 'Search or type' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
  });

  it('starts a voice command from the mic and stops it while listening', async () => {
    render(<LeafyApp />);

    fireEvent.click(screen.getByRole('button', { name: 'Talk to Leafy' }));
    await waitFor(() => expect(calledWith(ctx.invoke, 'voice:start', { mode: 'command', source: 'leafy' })).toBe(true));

    act(() => ctx.bridge.emit('voice:snapshot', { ...IDLE_SNAPSHOT, sessionId: 's1', phase: 'listening', mode: 'command', source: 'leafy' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop listening' }));

    await waitFor(() => expect(calledWith(ctx.invoke, 'voice:stop')).toBe(true));
    expect(screen.getByText('I’m listening')).toBeTruthy();
  });

  it('opens the palette and the native menu from the toolbar', async () => {
    render(<LeafyApp />);

    fireEvent.click(screen.getByRole('button', { name: 'Search or type' }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    await waitFor(() => expect(calledWith(ctx.invoke, 'window:open', { target: 'palette', mode: 'search' })).toBe(true));
    expect(calledWith(ctx.invoke, 'leafy:menu')).toBe(true);
  });

  it('becomes clickable while the pointer is over Leafy', async () => {
    render(<LeafyApp />);
    const leafy = screen.getByRole('button', { name: /^Leafy\./ });

    fireEvent.pointerEnter(leafy);

    await waitFor(() => expect(calledWith(ctx.invoke, 'leafy:pointer', { interactive: true })).toBe(true));
  });

  it('drags the window after 4 px and reports the drop', async () => {
    render(<LeafyApp />);
    const leafy = screen.getByRole('button', { name: /^Leafy\./ });

    fireEvent.pointerDown(leafy, { button: 0, pointerId: 1, screenX: 1000, screenY: 800, clientX: 150, clientY: 200 });
    fireEvent.pointerMove(leafy, { pointerId: 1, buttons: 1, screenX: 1002, screenY: 801 });
    fireEvent.pointerMove(leafy, { pointerId: 1, buttons: 1, screenX: 1040, screenY: 760 });
    fireEvent.pointerUp(leafy, { pointerId: 1, screenX: 1040, screenY: 760 });

    await waitFor(() => expect(calledWith(ctx.invoke, 'leafy:dragEnd')).toBe(true));
    expect(calledWith(ctx.invoke, 'leafy:moveTo', { x: 890, y: 560 })).toBe(true);
    expect(calledWith(ctx.invoke, 'window:open')).toBe(false);
  });

  it('abandons a press whose release it never saw instead of dragging with no button held', async () => {
    render(<LeafyApp />);
    const leafy = screen.getByRole('button', { name: /^Leafy\./ });

    fireEvent.pointerDown(leafy, { button: 0, pointerId: 3, screenX: 100, screenY: 100, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(leafy, { pointerId: 3, buttons: 0, screenX: 160, screenY: 160 });
    fireEvent.pointerMove(leafy, { pointerId: 3, buttons: 0, screenX: 200, screenY: 200 });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calledWith(ctx.invoke, 'leafy:moveTo')).toBe(false);
    expect(calledWith(ctx.invoke, 'leafy:dragEnd')).toBe(false);
  });

  it('ignores Ctrl+click (the macOS context-menu gesture) as a drag or click', async () => {
    render(<LeafyApp />);
    const leafy = screen.getByRole('button', { name: /^Leafy\./ });

    fireEvent.pointerDown(leafy, { button: 0, ctrlKey: true, pointerId: 4, screenX: 10, screenY: 10, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(leafy, { pointerId: 4, screenX: 10, screenY: 10 });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calledWith(ctx.invoke, 'window:open')).toBe(false);
  });

  it('hands clicks back to the desktop when a hovered bubble is dismissed', async () => {
    render(<LeafyApp />);
    const bubble = (await screen.findByText('Hi there')).closest('.lf-bubble') as HTMLElement;

    fireEvent.pointerEnter(bubble);
    await waitFor(() => expect(calledWith(ctx.invoke, 'leafy:pointer', { interactive: true })).toBe(true));
    fireEvent.click(bubble);

    await waitFor(() => expect(ctx.invoke.mock.calls.filter(([c]) => c === 'leafy:pointer').at(-1)?.[1]).toEqual({ interactive: false }));
  });

  it('opens the palette on a plain click (after the double-click window)', async () => {
    render(<LeafyApp />);
    const leafy = screen.getByRole('button', { name: /^Leafy\./ });

    fireEvent.pointerDown(leafy, { button: 0, pointerId: 2, screenX: 10, screenY: 10, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(leafy, { pointerId: 2, screenX: 10, screenY: 10 });

    await waitFor(() => expect(calledWith(ctx.invoke, 'window:open', { target: 'palette' })).toBe(true));
    expect(calledWith(ctx.invoke, 'leafy:moveTo')).toBe(false);
  });
});
