// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceSnapshot } from '@shared/types';
import { IslandApp } from '../../../src/renderer/island/IslandApp';
import { IDLE_SNAPSHOT } from '../../../src/renderer/lib/hooks/useVoiceSnapshot';
import { calledWith, setupOverlayBridge, type OverlayBridge } from '../hooks/overlay-dom';

const push = (ctx: OverlayBridge, patch: Partial<VoiceSnapshot>) =>
  act(() => ctx.bridge.emit('voice:snapshot', { ...IDLE_SNAPSHOT, sessionId: 's1', ...patch }));

describe('Dynamic Island window', () => {
  let ctx: OverlayBridge;

  beforeEach(() => {
    ctx = setupOverlayBridge();
  });

  afterEach(() => cleanup());

  it('rests hidden while idle and announces listening', async () => {
    const { container } = render(<IslandApp />);
    expect(container.querySelector('.il-wrap')?.getAttribute('data-visible')).toBe('false');

    push(ctx, { phase: 'listening', mode: 'command' });

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Listening (Leafy)'));
    expect(container.querySelector('.il-wrap')?.getAttribute('data-visible')).toBe('true');
  });

  it('turns click-through off over the capsule and back on when it leaves', async () => {
    const { container } = render(<IslandApp />);
    push(ctx, { phase: 'acting', mode: 'command', detail: 'Opening Calendar' });
    const capsule = container.querySelector('.rt-island__capsule') as HTMLElement;

    fireEvent.pointerEnter(capsule);
    fireEvent.pointerLeave(capsule);

    await waitFor(() => expect(calledWith(ctx.invoke, 'island:pointer', { interactive: true })).toBe(true));
    expect(ctx.invoke.mock.calls.filter(([c]) => c === 'island:pointer').at(-1)?.[1]).toEqual({ interactive: false });
  });

  it('confirms an action with big Do it / Not now buttons', async () => {
    render(<IslandApp />);
    push(ctx, {
      phase: 'confirming',
      mode: 'command',
      pending: { runId: 'r1', callId: 'c1', tool: 'quit_app', title: 'Quit Spotify', summary: 'Spotify will close.' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Do it' }));

    await waitFor(() => expect(calledWith(ctx.invoke, 'agent:confirm', { runId: 'r1', callId: 'c1', approved: true })).toBe(true));
    expect((screen.getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('makes the buttons usable again when the answer could not be delivered', async () => {
    ctx.invoke.mockImplementation(async (channel, request) => {
      if (channel === 'agent:confirm') throw new Error('Leafy is no longer waiting for an answer.');
      return ctx.fallbackInvoke(channel, request as never);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<IslandApp />);
    push(ctx, {
      phase: 'confirming',
      mode: 'command',
      pending: { runId: 'r1', callId: 'c1', tool: 'quit_app', title: 'Quit Spotify', summary: 'Spotify will close.' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Do it' }));

    await waitFor(() => expect((screen.getByRole('button', { name: 'Do it' }) as HTMLButtonElement).disabled).toBe(false));
    expect(errors).toHaveBeenCalled();
  });

  it('offers Settings for errors that need a setting changed', async () => {
    render(<IslandApp />);
    push(ctx, { phase: 'error', mode: 'dictate', error: { code: 'mic-denied', message: 'Rivertide can’t use the microphone yet.' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    await waitFor(() => expect(calledWith(ctx.invoke, 'window:open', { target: 'dashboard', route: '/settings' })).toBe(true));
  });

  it('shows the dictation result with its paste status', async () => {
    render(<IslandApp />);

    push(ctx, { phase: 'done', mode: 'dictate', output: 'This is a longer paragraph that Rivertide tidied up for you.', pasted: false });

    expect(await screen.findByText('Copied — press ⌘V to paste')).toBeTruthy();
  });
});
