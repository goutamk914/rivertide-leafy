/**
 * Shared setup for overlay DOM tests (jsdom): stubs browser APIs jsdom lacks and installs the
 * overlays' in-memory fallback bridge with a spy on `invoke`, so tests can push events with
 * `bridge.emit(...)` and assert on the channels a window calls.
 */
import { vi } from 'vitest';
import type { InvokeChannel } from '@shared/ipc-channels';
import type { InvokeRequest } from '@shared/ipc';
import { installMockBridge } from '../../../src/renderer/lib/ipc';
import { createFallbackBridge } from '../../../src/renderer/lib/hooks/devBridge';

export function stubOverlayBrowserApis(): void {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
}

export type OverlayBridge = ReturnType<typeof setupOverlayBridge>;

export function setupOverlayBridge() {
  stubOverlayBrowserApis();
  const bridge = createFallbackBridge();
  const fallbackInvoke = bridge.invoke.bind(bridge);
  const invoke = vi.spyOn(bridge, 'invoke');
  invoke.mockImplementation(fallbackInvoke);
  installMockBridge(bridge);
  return { bridge, invoke, fallbackInvoke };
}

/** True when `invoke` was called with this channel and (optionally) a matching request. */
export function calledWith<C extends InvokeChannel>(
  invoke: OverlayBridge['invoke'],
  channel: C,
  request?: Partial<NonNullable<InvokeRequest<C>>>,
): boolean {
  return invoke.mock.calls.some(([c, r]) => {
    if (c !== channel) return false;
    if (request === undefined) return true;
    return Object.entries(request).every(([k, v]) => (r as Record<string, unknown> | undefined)?.[k] === v);
  });
}
