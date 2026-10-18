/**
 * Typed renderer-side access to the preload bridge (`window.rivertide`).
 * In `npm run dev:web` (plain browser, no Electron) a mock bridge is installed instead,
 * so every window can be developed and screenshotted without the main process.
 */
import type { EventChannel, InvokeChannel, SendChannel } from '@shared/ipc-channels';
import type { EventPayload, InvokeRequest, InvokeResult, RivertideBridge, SendPayload } from '@shared/ipc';

declare global {
  interface Window {
    rivertide?: RivertideBridge;
  }
}

let mockBridge: RivertideBridge | null = null;

/** Lets the browser dev harness supply a fake bridge (see lib/mock-bridge.ts). */
export function installMockBridge(bridge: RivertideBridge): void {
  mockBridge = bridge;
}

export function bridge(): RivertideBridge {
  const real = typeof window !== 'undefined' ? window.rivertide : undefined;
  const active = real ?? mockBridge;
  if (!active) throw new Error('Rivertide bridge is not available in this window.');
  return active;
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.rivertide !== undefined;
}

export function invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResult<C>> {
  return bridge().invoke(channel, request);
}

export function send<C extends SendChannel>(channel: C, payload: SendPayload<C>): void {
  bridge().send(channel, payload);
}

/** Subscribes to a main-process event; returns the unsubscribe function. */
export function on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void {
  return bridge().on(channel, listener);
}

export function platform(): RivertideBridge['platform'] {
  return bridge().platform;
}

/** Turns an IPC rejection into a sentence a person can act on. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Electron prefixes remote errors with "Error invoking remote method '<channel>': Error: ".
  return raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '').trim() || 'Something went wrong.';
}
