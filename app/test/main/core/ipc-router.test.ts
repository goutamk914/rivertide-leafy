import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, protocol: {}, shell: {} }));

import { NOT_ALLOWED_MESSAGE } from '../../../src/main/ipc/errors';
import { createIpcRouter, defaultAllow, LEVEL_INTERVAL_MS, type IpcMainLike, type SenderEvent } from '../../../src/main/ipc/router';
import type { WindowKind } from '../../../src/main/services';
import { INVOKE_CHANNELS } from '../../../src/shared/ipc-channels';
import { fakeContext, fakeWindows, memoryLogger } from './fakes';

const ORIGIN = 'app://rivertide';

type InvokeListener = (event: SenderEvent, ...args: unknown[]) => unknown;

function fakeIpcMain() {
  const handlers = new Map<string, InvokeListener>();
  const listeners = new Map<string, InvokeListener>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
    on: (channel, listener) => {
      listeners.set(channel, listener);
    },
  };
  return { ipcMain, handlers, listeners };
}

const KINDS: Record<number, WindowKind> = { 1: 'dashboard', 2: 'engine', 3: 'leafy', 4: 'island', 5: 'palette' };

function setup(now = () => 0) {
  const windows = { ...fakeWindows(), kindOf: vi.fn((id: number) => KINDS[id] ?? null) };
  const logger = memoryLogger();
  const ctx = fakeContext({ windows, logger });
  const fake = fakeIpcMain();
  const router = createIpcRouter(ctx, { ipcMain: fake.ipcMain, allowedOrigin: ORIGIN, now });
  return { ctx, logger, router, ...fake };
}

const event = (id: number, url = `${ORIGIN}/main.html`, parent: unknown = null): SenderEvent => ({ sender: { id }, senderFrame: { parent, url } });

describe('IPC router', () => {
  it('validates the request and passes parsed input plus sender info to the handler', async () => {
    // Arrange
    const { router, handlers } = setup();
    const handler = vi.fn(() => ({ ok: true as const }));
    router.handle('island:pointer', handler, { allow: ['dashboard'] });

    // Act
    const result = await handlers.get('island:pointer')?.(event(1), { interactive: true });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({ interactive: true }, { kind: 'dashboard', webContentsId: 1 });
  });

  it('rejects invalid input with a short readable message', async () => {
    // Arrange
    const { router, handlers } = setup();
    router.handle('history:get', vi.fn());

    // Act
    const call = handlers.get('history:get')?.(event(1), { id: '' });

    // Assert
    await expect(call).rejects.toThrow(/^That request wasn't valid: id — /);
  });

  it('rejects senders that are not our windows, sub-frames and foreign origins', async () => {
    // Arrange
    const { router, handlers } = setup();
    const handler = vi.fn();
    router.handle('settings:get', handler);
    const call = (e: SenderEvent) => handlers.get('settings:get')?.(e, undefined);

    // Act / Assert
    await expect(call(event(99))).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    await expect(call(event(1, `${ORIGIN}/main.html`, { parent: 'frame' }))).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    await expect(call(event(1, 'https://evil.example/'))).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    await expect(call({ sender: { id: 1 }, senderFrame: null })).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    expect(handler).not.toHaveBeenCalled();
  });

  it('applies the default window rules per namespace', async () => {
    // Arrange
    const { router, handlers } = setup();
    router.handle('engine:ready', vi.fn(() => ({ ok: true as const })));
    router.handle('leafy:menu', vi.fn(() => ({ ok: true as const })));
    router.handle('app:info', vi.fn());

    // Act / Assert
    await expect(handlers.get('engine:ready')?.(event(1), undefined)).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    await expect(handlers.get('engine:ready')?.(event(2), undefined)).resolves.toEqual({ ok: true });
    await expect(handlers.get('leafy:menu')?.(event(5), undefined)).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    await expect(handlers.get('app:info')?.(event(2), undefined)).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    expect(defaultAllow('island:pointer')).toEqual(['island']);
    expect(defaultAllow('chat:send')).toEqual(['dashboard', 'island', 'leafy', 'palette']);
  });

  it('turns handler errors into plain messages and logs the detail', async () => {
    // Arrange
    const { router, handlers, logger } = setup();
    router.handle('chat:list', () => {
      throw new Error('The chat file is busy. Try again in a moment.');
    });

    // Act
    const call = handlers.get('chat:list')?.(event(1), undefined);

    // Assert
    await expect(call).rejects.toThrow('The chat file is busy. Try again in a moment.');
    expect(logger.entries.some((e) => e.level === 'error' && e.meta?.channel === 'chat:list')).toBe(true);
  });

  it('ignores duplicate handlers and reports channels without one', () => {
    // Arrange
    const { router, logger } = setup();
    const first = vi.fn();

    // Act
    router.handle('app:info', first);
    router.handle('app:info', vi.fn());
    const missing = router.missingChannels();

    // Assert
    expect(missing).toHaveLength(INVOKE_CHANNELS.length - 1);
    expect(missing).not.toContain('app:info');
    expect(logger.entries.some((e) => e.message.includes('second handler'))).toBe(true);
  });

  it('keeps registering other modules when one throws', () => {
    // Arrange
    const { router, logger } = setup();

    // Act
    router.registerModules([
      ['broken', () => { throw new Error('boom'); }],
      ['fine', (_ctx, handle) => handle('app:info', vi.fn())],
    ]);

    // Assert
    expect(router.missingChannels()).not.toContain('app:info');
    expect(logger.entries.some((e) => e.meta?.module === 'broken')).toBe(true);
  });

  it('throttles engine levels to about 30 per second, from the engine only', () => {
    // Arrange
    let clock = 0;
    const { router, listeners, ctx } = setup(() => clock);
    const levels = vi.fn();
    ctx.bus.on('audio:level', levels);
    router.listenForLevels();
    const send = (id: number, payload: unknown) => listeners.get('engine:level')?.(event(id), payload);

    // Act
    send(2, { level: 0.5, bands: [0.1, 0.2] });
    clock = LEVEL_INTERVAL_MS - 1;
    send(2, { level: 0.6, bands: [] });
    clock = LEVEL_INTERVAL_MS + 1;
    send(2, { level: 2, bands: [] });
    send(2, { level: 0.7, bands: [] });
    send(1, { level: 0.9, bands: [] });

    // Assert
    expect(levels.mock.calls.map(([payload]) => payload.level)).toEqual([0.5, 0.7]);
  });
});
