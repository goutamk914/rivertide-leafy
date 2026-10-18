import { describe, expect, it } from 'vitest';
import { createFallbackBridge } from '../../../src/renderer/lib/hooks/devBridge';
import { resolveTheme } from '../../../src/renderer/lib/hooks/useApplyAppearance';
import { nextWake } from '../../../src/renderer/lib/hooks/useClock';
import { isCueActive } from '../../../src/renderer/lib/hooks/useLeafyCue';
import { resolveReducedMotion } from '../../../src/renderer/lib/hooks/useReducedMotion';
import { IDLE_SNAPSHOT } from '../../../src/renderer/lib/hooks/useVoiceSnapshot';

describe('resolveReducedMotion', () => {
  it('lets the in-app choice override the OS', () => {
    expect(resolveReducedMotion('on', false)).toBe(true);
    expect(resolveReducedMotion('off', true)).toBe(false);
    expect(resolveReducedMotion('system', true)).toBe(true);
    expect(resolveReducedMotion(undefined, false)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('follows the explicit choice, else the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme(undefined, true)).toBe('dark');
  });
});

describe('nextWake', () => {
  it('picks the earliest future timestamp and ignores the past and empties', () => {
    expect(nextWake([500, 300, null, undefined, 50], 100)).toBe(300);
    expect(nextWake([10, 20], 100)).toBeNull();
    expect(nextWake([], 0)).toBeNull();
  });
});

describe('isCueActive', () => {
  const cue = (holdMs: number | null) => ({ cue: { mood: 'notify' as const, say: 'Time for water', holdMs }, receivedAt: 1000, seq: 1 });

  it('is active within its hold and inactive after', () => {
    expect(isCueActive(cue(2000), 2500)).toBe(true);
    expect(isCueActive(cue(2000), 3000)).toBe(false);
  });

  it('stays active until replaced when hold is null', () => {
    expect(isCueActive(cue(null), 10_000_000)).toBe(true);
    expect(isCueActive(null, 0)).toBe(false);
  });
});

describe('createFallbackBridge', () => {
  it('answers the channels the overlays read', async () => {
    const bridge = createFallbackBridge();

    expect(await bridge.invoke('voice:snapshot', undefined)).toEqual(IDLE_SNAPSHOT);
    expect(await bridge.invoke('palette:search', { query: 'x' })).toEqual([]);
    expect(await bridge.invoke('leafy:position', undefined)).toEqual({ x: 0, y: 0, corner: 'right' });
    expect(await bridge.invoke('island:pointer', { interactive: true })).toEqual({ ok: true });
  });

  it('delivers emitted events until unsubscribed', () => {
    const bridge = createFallbackBridge();
    const seen: string[] = [];
    const off = bridge.on('toast', (t) => seen.push(t.message));

    bridge.emit('toast', { kind: 'info', message: 'one' });
    off();
    bridge.emit('toast', { kind: 'info', message: 'two' });

    expect(seen).toEqual(['one']);
  });
});
