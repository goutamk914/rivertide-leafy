/**
 * Browser development support (`npm run dev:web`). Outside Electron, installs the dashboard's
 * mock bridge (`lib/mock-bridge.ts`, `installDevMock()`) when it exists; otherwise installs a tiny
 * built-in fallback so the overlay windows still render standalone. `import.meta.glob` keeps the
 * build green whether or not the mock file exists yet.
 */
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels';
import type { EventPayload, InvokeRequest, InvokeResult, RivertideBridge } from '@shared/ipc';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { installMockBridge, isElectron } from '../ipc';
import { reportError } from './bridge';
import { IDLE_SNAPSHOT } from './useVoiceSnapshot';

interface MockModule {
  readonly installDevMock?: () => unknown;
}

const MOCK_PATH = '../mock-bridge.ts';

type Listener = (payload: unknown) => void;

/** Answers for the handful of channels the overlays read; everything else resolves `{ ok: true }`. */
function fallbackAnswer(channel: InvokeChannel): unknown {
  switch (channel) {
    case 'voice:snapshot':
    case 'voice:start':
    case 'voice:stop':
    case 'voice:cancel':
      return IDLE_SNAPSHOT;
    case 'settings:get':
      return DEFAULT_SETTINGS;
    case 'palette:search':
      return [];
    case 'palette:execute':
      return { ok: true, message: null };
    case 'leafy:position':
      return { x: 0, y: 0, corner: 'right' };
    case 'agent:ask':
      return { runId: `dev-${Date.now()}` };
    default:
      return { ok: true };
  }
}

/** A minimal in-memory bridge. `emit` lets dev harnesses push events. */
export function createFallbackBridge(): RivertideBridge & { emit<C extends EventChannel>(channel: C, payload: EventPayload<C>): void } {
  const listeners = new Map<EventChannel, ReadonlySet<Listener>>();
  return {
    platform: 'darwin',
    invoke<C extends InvokeChannel>(channel: C, _request: InvokeRequest<C>): Promise<InvokeResult<C>> {
      return Promise.resolve(fallbackAnswer(channel) as InvokeResult<C>);
    },
    send: () => undefined,
    on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void {
      const current = listeners.get(channel) ?? new Set<Listener>();
      listeners.set(channel, new Set([...current, listener as Listener]));
      return () => {
        const set = listeners.get(channel) ?? new Set<Listener>();
        listeners.set(channel, new Set([...set].filter((l) => l !== listener)));
      };
    },
    emit<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
      for (const listener of listeners.get(channel) ?? []) listener(payload);
    },
  };
}

/** Call once at the top of each overlay entry, before rendering. No-op inside Electron. */
export async function ensureDevBridge(): Promise<void> {
  if (isElectron()) return;
  // Dev-only: in production builds the branch (and the mock chunk) is dropped entirely.
  const loaders = import.meta.env.DEV ? import.meta.glob<MockModule>('../mock-bridge.ts') : {};
  const load = loaders[MOCK_PATH];
  if (load) {
    try {
      const mod = await load();
      if (typeof mod.installDevMock === 'function') {
        await mod.installDevMock();
        return;
      }
    } catch (error) {
      reportError('dev-mock', error);
    }
  }
  installMockBridge(createFallbackBridge());
}
