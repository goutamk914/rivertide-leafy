/**
 * Shared helpers for dashboard DOM tests (jsdom). Installs a fresh zero-latency mock bridge,
 * seeds the settings store, and stubs browser APIs jsdom lacks (canvas, matchMedia).
 */
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MotionConfig } from 'motion/react';
import { installMockBridge } from '../../../src/renderer/lib/ipc';
import { createMockBridge, type MockBridge, type MockBridgeOptions } from '../../../src/renderer/lib/mock-bridge';
import { useSettingsStore } from '../../../src/renderer/dashboard/state/settings-store';
import { useToastStore } from '../../../src/renderer/ui/components/toast-store';

export const FIXED_NOW = new Date('2026-10-15T15:00:00.000Z');

export function stubBrowserApis(): void {
  // jsdom has no canvas; LeafySprite and the graph tolerate a null context.
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

/** Installs a fresh mock bridge and loads its settings into the store. */
export function setupBridge(options: MockBridgeOptions = {}): MockBridge {
  stubBrowserApis();
  const bridge = createMockBridge({ latencyMs: 0, now: () => FIXED_NOW, ...options });
  installMockBridge(bridge);
  useSettingsStore.setState({ settings: bridge.getState().settings, loadError: null, saveState: 'idle', saveError: null });
  useToastStore.setState({ toasts: [] });
  return bridge;
}

/** Renders with motion's reduced-motion config so layout animations settle instantly. */
export function renderUi(ui: ReactElement): RenderResult {
  return render(<MotionConfig reducedMotion="always">{ui}</MotionConfig>);
}
