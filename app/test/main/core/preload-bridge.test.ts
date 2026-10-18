import { describe, expect, it, vi } from 'vitest';
import { createBridge, toBridgePlatform, type IpcRendererLike } from '../../../src/preload/bridge';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings';

type Listener = (event: unknown, ...args: unknown[]) => void;

function fakeIpc() {
  const listeners = new Map<string, Listener[]>();
  const ipc: IpcRendererLike & { emit(channel: string, payload: unknown): void } = {
    invoke: vi.fn(async (channel: string) => ({ channel })),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: Listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.set(channel, (listeners.get(channel) ?? []).filter((l) => l !== listener));
    }),
    emit(channel, payload) {
      (listeners.get(channel) ?? []).forEach((listener) => listener({ sender: 'ipc' }, payload));
    },
  };
  return ipc;
}

describe('preload bridge', () => {
  it('invokes contract channels and rejects anything else', async () => {
    // Arrange
    const ipc = fakeIpc();
    const bridge = createBridge(ipc, 'darwin');

    // Act
    const ok = await bridge.invoke('settings:get', undefined);
    const rejected = bridge.invoke('fs:readFile' as never, {} as never);

    // Assert
    expect(ok).toEqual({ channel: 'settings:get' });
    await expect(rejected).rejects.toThrow(/Unknown channel/);
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
  });

  it('sends only allow-listed fire-and-forget channels', () => {
    // Arrange
    const ipc = fakeIpc();
    const bridge = createBridge(ipc, 'darwin');

    // Act
    bridge.send('engine:level', { level: 0.2, bands: [] });

    // Assert
    expect(ipc.send).toHaveBeenCalledWith('engine:level', { level: 0.2, bands: [] });
    expect(() => bridge.send('evil' as never, {} as never)).toThrow(/Unknown channel/);
  });

  it('passes only the payload to listeners (never the raw IPC event)', () => {
    // Arrange
    const ipc = fakeIpc();
    const bridge = createBridge(ipc, 'darwin');
    const listener = vi.fn();
    bridge.on('settings:changed', listener);

    // Act
    ipc.emit('settings:changed', DEFAULT_SETTINGS);

    // Assert
    expect(listener).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(listener.mock.calls[0]).toHaveLength(1);
  });

  it('unsubscribe removes only that listener, and twice is harmless', () => {
    // Arrange
    const ipc = fakeIpc();
    const bridge = createBridge(ipc, 'darwin');
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = bridge.on('toast', first);
    bridge.on('toast', second);

    // Act
    offFirst();
    offFirst();
    ipc.emit('toast', { kind: 'info', message: 'hello' });

    // Assert
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(ipc.removeListener).toHaveBeenCalledTimes(1);
  });

  it('refuses to subscribe to unknown events and exposes a normalised platform', () => {
    const bridge = createBridge(fakeIpc(), 'freebsd');
    expect(() => bridge.on('secret:leak' as never, vi.fn())).toThrow(/Unknown event/);
    expect(bridge.platform).toBe('linux');
    expect(toBridgePlatform('win32')).toBe('win32');
    expect(Object.isFrozen(bridge)).toBe(true);
  });
});
