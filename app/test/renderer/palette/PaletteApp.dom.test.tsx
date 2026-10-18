// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchResult } from '@shared/types';
import { PaletteApp } from '../../../src/renderer/palette/PaletteApp';
import { calledWith, setupOverlayBridge, type OverlayBridge } from '../hooks/overlay-dom';

const RESULTS: SearchResult[] = [
  { id: 'app:cal', kind: 'app', title: 'Calendar', subtitle: 'Application', icon: 'icon:calendar', score: 0.9 },
  { id: 'file:1', kind: 'file', title: 'calendar-notes.txt', subtitle: '~/Documents', icon: null, score: 0.4 },
];

describe('Leafy palette', () => {
  let ctx: OverlayBridge;

  beforeEach(() => {
    ctx = setupOverlayBridge();
    ctx.invoke.mockImplementation(async (channel, request) => {
      if (channel === 'palette:search') return RESULTS as never;
      if (channel === 'agent:ask') return { runId: 'run-1' } as never;
      return ctx.fallbackInvoke(channel, request as never);
    });
  });

  afterEach(() => cleanup());

  const input = () => screen.getByRole('combobox', { name: 'Search or ask Leafy' }) as HTMLInputElement;

  it('shows a greeting, suggestions and shortcuts before you type', async () => {
    render(<PaletteApp />);

    expect(await screen.findByText(/What can I do for you/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set a timer for 10 minutes' })).toBeTruthy();
    expect(screen.getByText('This palette')).toBeTruthy();
  });

  it('searches as you type, groups results and runs the chosen one', async () => {
    // Arrange
    render(<PaletteApp />);

    // Act
    fireEvent.change(input(), { target: { value: 'cal' } });
    await screen.findByText('Top hit');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter', altKey: true });

    // Assert
    expect(calledWith(ctx.invoke, 'palette:search', { query: 'cal' })).toBe(true);
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('calendar-notes.txt');
    await waitFor(() => expect(calledWith(ctx.invoke, 'palette:execute', { id: 'file:1', alt: true })).toBe(true));
  });

  it('runs an Enter pressed before results arrive against the fresh results, not the old ones', async () => {
    render(<PaletteApp />);
    fireEvent.change(input(), { target: { value: 'ca' } });
    await screen.findByText('Top hit');

    fireEvent.change(input(), { target: { value: 'cal' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(calledWith(ctx.invoke, 'palette:execute')).toBe(false);

    await waitFor(() => expect(calledWith(ctx.invoke, 'palette:execute', { id: 'app:cal', alt: false })).toBe(true));
    expect(ctx.invoke.mock.calls.filter(([c]) => c === 'palette:execute')).toHaveLength(1);
  });

  it('keeps the keyboard in the input after clicking a suggestion', async () => {
    render(<PaletteApp />);
    const chip = await screen.findByRole('button', { name: 'Open Calendar' });

    const allowed = fireEvent.mouseDown(chip);

    expect(allowed).toBe(false);
  });

  it('clears on the first Esc and hides on the second', async () => {
    render(<PaletteApp />);
    fireEvent.change(input(), { target: { value: 'x' } });

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('');
    fireEvent.keyDown(input(), { key: 'Escape' });

    await waitFor(() => expect(calledWith(ctx.invoke, 'palette:hide')).toBe(true));
  });

  it('asks Leafy from a suggestion and shows steps, a confirmation and the reply', async () => {
    render(<PaletteApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set a timer for 10 minutes' }));
    act(() => {
      ctx.bridge.emit('agent:event', { type: 'run-start', runId: 'run-1', input: 'Set a timer for 10 minutes', source: 'palette' });
      ctx.bridge.emit('agent:event', { type: 'tool-start', runId: 'run-1', callId: 'c1', tool: 'set_timer', title: 'Setting a timer' });
    });
    await waitFor(() => expect(calledWith(ctx.invoke, 'agent:ask', { text: 'Set a timer for 10 minutes', source: 'palette' })).toBe(true));
    act(() => {
      ctx.bridge.emit('agent:event', {
        type: 'tool-confirm',
        runId: 'run-1',
        confirmation: { runId: 'run-1', callId: 'c1', tool: 'set_timer', title: 'Start a 10 minute timer', summary: 'A timer will ring in 10 minutes.' },
      });
    });
    await screen.findByText('Start a 10 minute timer');
    fireEvent.keyDown(input(), { key: 'y' });
    act(() => {
      ctx.bridge.emit('agent:event', { type: 'tool-end', runId: 'run-1', callId: 'c1', ok: true, summary: 'Timer set' });
      ctx.bridge.emit('agent:event', { type: 'run-end', runId: 'run-1', text: 'Your timer is running.', ok: true });
    });

    // Once on screen, once in the polite status region for screen readers.
    expect(await screen.findAllByText('Your timer is running.')).toHaveLength(2);
    expect(screen.getByText('Setting a timer')).toBeTruthy();
    expect(calledWith(ctx.invoke, 'agent:confirm', { runId: 'run-1', callId: 'c1', approved: true })).toBe(true);
    expect(screen.queryByText('Start a 10 minute timer')).toBeNull();
  });

  it('starts listening when opened in voice mode', async () => {
    render(<PaletteApp />);

    act(() => ctx.bridge.emit('palette:open', { mode: 'voice', query: null }));

    await waitFor(() => expect(calledWith(ctx.invoke, 'voice:start', { mode: 'command', source: 'palette' })).toBe(true));
  });

  it('reports its height to main', async () => {
    render(<PaletteApp />);

    await waitFor(() => expect(calledWith(ctx.invoke, 'palette:resize')).toBe(true));
  });
});
