// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { useAgentRun } from '../../../src/renderer/lib/hooks/useAgentRun';
import { useAudioLevel } from '../../../src/renderer/lib/hooks/useAudioLevel';
import { useClock } from '../../../src/renderer/lib/hooks/useClock';
import { useLeafyCue } from '../../../src/renderer/lib/hooks/useLeafyCue';
import { useSettings } from '../../../src/renderer/lib/hooks/useSettings';
import { IDLE_SNAPSHOT, useVoiceSnapshot } from '../../../src/renderer/lib/hooks/useVoiceSnapshot';
import { setupOverlayBridge, type OverlayBridge } from './overlay-dom';

describe('overlay hooks', () => {
  let ctx: OverlayBridge;

  beforeEach(() => {
    ctx = setupOverlayBridge();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('useVoiceSnapshot starts idle and follows pushes', async () => {
    // Arrange
    const { result } = renderHook(() => useVoiceSnapshot());
    expect(result.current).toEqual(IDLE_SNAPSHOT);

    // Act
    act(() => ctx.bridge.emit('voice:snapshot', { ...IDLE_SNAPSHOT, sessionId: 's', phase: 'listening', mode: 'dictate' }));

    // Assert
    await waitFor(() => expect(result.current.phase).toBe('listening'));
  });

  it('useSettings loads, then follows settings:changed', async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current).toEqual(DEFAULT_SETTINGS));
    act(() => ctx.bridge.emit('settings:changed', { ...DEFAULT_SETTINGS, profile: { name: 'Sam' } }));

    expect(result.current?.profile.name).toBe('Sam');
  });

  it('useAudioLevel keeps the latest level in a ref and resets when inactive', () => {
    const { result, rerender } = renderHook(({ active }) => useAudioLevel(active), { initialProps: { active: true } });

    act(() => ctx.bridge.emit('audio:level', { level: 0.7, bands: [0.1] }));
    expect(result.current.current.level).toBe(0.7);

    rerender({ active: false });
    expect(result.current.current.level).toBe(0);
  });

  it('useLeafyCue numbers each cue', () => {
    const { result } = renderHook(() => useLeafyCue());

    act(() => ctx.bridge.emit('leafy:cue', { mood: 'notify', say: 'One', holdMs: 1000 }));
    act(() => ctx.bridge.emit('leafy:cue', { mood: 'notify', say: 'One', holdMs: 1000 }));

    expect(result.current?.seq).toBe(2);
    expect(result.current?.cue.say).toBe('One');
  });

  it('useAgentRun keeps events that arrive before the run id is known', () => {
    const { result, rerender } = renderHook(({ id }) => useAgentRun(id), { initialProps: { id: null as string | null } });

    act(() => {
      ctx.bridge.emit('agent:event', { type: 'run-start', runId: 'r1', input: 'hi', source: 'palette' });
      ctx.bridge.emit('agent:event', { type: 'text', runId: 'r1', delta: 'Hello' });
    });
    expect(result.current).toBeNull();
    rerender({ id: 'r1' });

    expect(result.current?.text).toBe('Hello');
  });

  it('useAgentRun("latest") follows the newest run from allowed sources', () => {
    const { result } = renderHook(() => useAgentRun('latest', { sources: ['voice'] }));

    act(() => {
      ctx.bridge.emit('agent:event', { type: 'run-start', runId: 'v1', input: 'a', source: 'voice' });
      ctx.bridge.emit('agent:event', { type: 'run-start', runId: 'p1', input: 'b', source: 'palette' });
    });

    expect(result.current?.runId).toBe('v1');
  });

  it('useClock re-renders exactly when a wake time passes', () => {
    vi.useFakeTimers();
    const start = Date.now();
    const { result } = renderHook(() => useClock([start + 1000]));
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(result.current).toBeGreaterThan(first);
  });
});
