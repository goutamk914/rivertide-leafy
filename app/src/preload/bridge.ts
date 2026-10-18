/**
 * The `window.rivertide` bridge, built over an ipcRenderer-like object. Only channels listed in
 * shared/ipc-channels.ts pass; validation happens in main (no zod here, the preload stays tiny).
 * `on()` returns an unsubscribe that removes exactly that listener and nothing else.
 */
import type { InvokeRequest, InvokeResult, RivertideBridge } from '../shared/ipc';
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS, type InvokeChannel } from '../shared/ipc-channels';

type IpcListener = (event: unknown, ...args: unknown[]) => void;

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: IpcListener): unknown;
  removeListener(channel: string, listener: IpcListener): unknown;
}

const INVOKE_SET: ReadonlySet<string> = new Set(INVOKE_CHANNELS);
const SEND_SET: ReadonlySet<string> = new Set(SEND_CHANNELS);
const EVENT_SET: ReadonlySet<string> = new Set(EVENT_CHANNELS);

export function toBridgePlatform(platform: string): RivertideBridge['platform'] {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux';
}

export function createBridge(ipc: IpcRendererLike, platform: string): RivertideBridge {
  const invoke = <C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResult<C>> => {
    if (!INVOKE_SET.has(channel)) return Promise.reject(new Error(`Unknown channel "${String(channel)}".`));
    return ipc.invoke(channel, request) as Promise<InvokeResult<C>>;
  };
  const bridge: RivertideBridge = {
    invoke,
    send(channel, payload) {
      if (!SEND_SET.has(channel)) throw new Error(`Unknown channel "${String(channel)}".`);
      ipc.send(channel, payload);
    },
    on(channel, listener) {
      if (!EVENT_SET.has(channel)) throw new Error(`Unknown event "${String(channel)}".`);
      const wrapped: IpcListener = (_event, payload) => {
        (listener as (value: unknown) => void)(payload);
      };
      ipc.on(channel, wrapped);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        ipc.removeListener(channel, wrapped);
      };
    },
    platform: toBridgePlatform(platform),
  };
  return Object.freeze(bridge);
}
