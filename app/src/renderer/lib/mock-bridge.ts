/**
 * In-memory stand-in for the preload bridge, used by `npm run dev:web` (plain browser) and by tests.
 * Every invoke channel in the contract has a handler (enforced by the `MockHandlers` type); requests
 * are validated with the same zod schemas main uses, so renderer bugs surface in the browser too.
 * All sample content is invented — no real people or records.
 */
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels';
import { invokeSchemas, type EventPayload, type InvokeRequest, type InvokeResult, type RivertideBridge } from '@shared/ipc';
import { installMockBridge, isElectron } from './ipc';
import { seedState, type MockState } from './mock/data';
import type { MockContext, MockHandler, MockHandlers } from './mock/context';
import { contentHandlers } from './mock/handlers-content';
import { liveHandlers } from './mock/handlers-live';
import { systemHandlers } from './mock/handlers-system';

const DEFAULT_LATENCY_MS = 160;

export interface MockBridgeOptions {
  /** Simulated round-trip delay per invoke (0 in tests). */
  readonly latencyMs?: number;
  readonly now?: () => Date;
  readonly state?: MockState;
}

export interface MockBridge extends RivertideBridge {
  readonly getState: () => MockState;
  readonly setState: (update: (state: MockState) => MockState) => void;
  /** Pushes an event to listeners, as main would. */
  readonly emit: <C extends EventChannel>(channel: C, payload: EventPayload<C>) => void;
  /** Cancels every pending simulated timer and interval. */
  readonly dispose: () => void;
}

type Listener = (payload: unknown) => void;

export function createMockBridge(options: MockBridgeOptions = {}): MockBridge {
  const now = options.now ?? (() => new Date());
  const latency = options.latencyMs ?? DEFAULT_LATENCY_MS;
  let state = options.state ?? seedState(now());
  const listeners = new Map<EventChannel, Set<Listener>>();
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();

  const emit = <C extends EventChannel>(channel: C, payload: EventPayload<C>) => {
    for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload);
  };

  const ctx: MockContext = {
    get: () => state,
    set: (update) => {
      state = update(state);
    },
    emit,
    now,
    schedule: (fn, ms) => {
      const handle = setTimeout(() => {
        timeouts.delete(handle);
        fn();
      }, ms);
      timeouts.add(handle);
    },
    every: (fn, ms) => {
      const handle = setInterval(fn, ms);
      intervals.add(handle);
      return () => {
        clearInterval(handle);
        intervals.delete(handle);
      };
    },
  };

  const handlers = {
    ...systemHandlers(ctx),
    ...contentHandlers(ctx),
    ...liveHandlers(ctx),
  } satisfies MockHandlers;

  const wait = () => (latency > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latency)) : Promise.resolve());

  async function invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResult<C>> {
    const schema = invokeSchemas[channel];
    const parsed = schema.safeParse(request);
    if (!parsed.success) {
      throw new Error(`Rivertide couldn’t handle that request (${channel}). ${parsed.error.issues[0]?.message ?? ''}`.trim());
    }
    await wait();
    const handler = handlers[channel] as unknown as MockHandler<C>;
    return handler(parsed.data as never);
  }

  return {
    platform: 'darwin',
    invoke,
    send: () => undefined,
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set<Listener>();
      set.add(listener as Listener);
      listeners.set(channel, set);
      return () => {
        set.delete(listener as Listener);
      };
    },
    getState: () => state,
    setState: ctx.set,
    emit,
    dispose: () => {
      timeouts.forEach(clearTimeout);
      intervals.forEach(clearInterval);
      timeouts.clear();
      intervals.clear();
    },
  };
}

let installed: MockBridge | null = null;

/**
 * Installs the browser mock once per window (no-op inside Electron, where the real bridge exists).
 * Returns the mock so dev tools can poke it, or null under Electron.
 */
export function installDevMock(options: MockBridgeOptions = {}): MockBridge | null {
  if (isElectron()) return null;
  if (!installed) {
    installed = createMockBridge(options);
    installMockBridge(installed);
  }
  return installed;
}
