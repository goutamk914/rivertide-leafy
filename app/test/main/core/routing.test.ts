import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../src/main/bus';
import { EVENT_ROUTES, forwardBusToWindows, routeFor, VISIBLE_ONLY_EVENTS } from '../../../src/main/windows/routing';
import { EVENT_CHANNELS } from '../../../src/shared/ipc-channels';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings';

describe('event routing', () => {
  it('has a route for every event channel in the contract', () => {
    for (const channel of EVENT_CHANNELS) expect(routeFor(channel).length).toBeGreaterThan(0);
  });

  it('never sends renderer events to the engine, and engine commands only to the engine', () => {
    for (const channel of EVENT_CHANNELS) {
      if (channel === 'engine:command') expect(EVENT_ROUTES[channel]).toEqual(['engine']);
      else expect(EVENT_ROUTES[channel]).not.toContain('engine');
    }
  });

  it('sends audio levels only to the island, Leafy and the palette, and only when visible', () => {
    expect(EVENT_ROUTES['audio:level']).toEqual(['island', 'leafy', 'palette']);
    expect(VISIBLE_ONLY_EVENTS.has('audio:level')).toBe(true);
  });

  it('forwards renderer-facing bus events and stops after unsubscribe', () => {
    // Arrange
    const bus = createBus(() => undefined);
    const broadcast = vi.fn();
    const stop = forwardBusToWindows(bus, broadcast);

    // Act
    bus.emit('settings:changed', DEFAULT_SETTINGS);
    bus.emit('toast', { kind: 'info', message: 'saved' });
    bus.emit('audio:level', { level: 0.5, bands: [0.1] });
    bus.emit('clap', { at: 1 });
    stop();
    bus.emit('toast', { kind: 'info', message: 'after stop' });

    // Assert
    expect(broadcast.mock.calls.map(([channel]) => channel)).toEqual(['settings:changed', 'toast', 'audio:level']);
  });
});
