/**
 * Which windows receive which main → renderer events, and the bus → renderer forwarder.
 * Pure (no Electron) so the routing rules are unit-tested.
 */
import type { EventPayload } from '../../shared/ipc';
import type { EventChannel } from '../../shared/ipc-channels';
import type { EventBus, WindowKind } from '../services';

export const RENDERER_WINDOWS: readonly WindowKind[] = ['dashboard', 'island', 'leafy', 'palette'];
const OVERLAYS_AND_PALETTE: readonly WindowKind[] = ['island', 'leafy', 'palette'];

export const EVENT_ROUTES: Readonly<Record<EventChannel, readonly WindowKind[]>> = {
  'settings:changed': RENDERER_WINDOWS,
  'voice:snapshot': RENDERER_WINDOWS,
  'agent:event': RENDERER_WINDOWS,
  'chat:event': RENDERER_WINDOWS,
  'data:changed': RENDERER_WINDOWS,
  'leafy:cue': RENDERER_WINDOWS,
  toast: RENDERER_WINDOWS,
  'audio:level': OVERLAYS_AND_PALETTE,
  navigate: ['dashboard'],
  'palette:open': ['palette'],
  'engine:command': ['engine'],
};

/** High-rate events that are pointless for hidden windows. */
export const VISIBLE_ONLY_EVENTS: ReadonlySet<EventChannel> = new Set<EventChannel>(['audio:level']);

export function routeFor(channel: EventChannel): readonly WindowKind[] {
  return EVENT_ROUTES[channel];
}

export type Broadcast = <C extends EventChannel>(channel: C, payload: EventPayload<C>) => void;

/** Forwards renderer-facing bus events to windows; returns an unsubscribe for all of them. */
export function forwardBusToWindows(bus: EventBus, broadcast: Broadcast): () => void {
  const subscriptions = [
    bus.on('settings:changed', (payload) => broadcast('settings:changed', payload)),
    bus.on('data:changed', (payload) => broadcast('data:changed', payload)),
    bus.on('voice:snapshot', (payload) => broadcast('voice:snapshot', payload)),
    bus.on('agent:event', (payload) => broadcast('agent:event', payload)),
    bus.on('chat:event', (payload) => broadcast('chat:event', payload)),
    bus.on('leafy:cue', (payload) => broadcast('leafy:cue', payload)),
    bus.on('toast', (payload) => broadcast('toast', payload)),
    bus.on('audio:level', (payload) => broadcast('audio:level', payload)),
  ];
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
}
