import { describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  shell: { openExternal: vi.fn(async () => undefined), showItemInFolder: vi.fn() },
  webContents: { fromId: vi.fn(() => ({ id: 1 })) },
  BrowserWindow: { fromWebContents: vi.fn() },
  app: { relaunch: vi.fn(), exit: vi.fn() },
  session: { defaultSession: { clearStorageData: vi.fn(async () => undefined) } },
}));
vi.mock('electron', () => electron);

import { registerAppHandlers } from '../../../src/main/ipc/handlers/app';
import { registerEngineHandlers } from '../../../src/main/ipc/handlers/engine';
import { registerIslandHandlers } from '../../../src/main/ipc/handlers/island';
import { registerLeafyHandlers } from '../../../src/main/ipc/handlers/leafy';
import { registerPermissionsHandlers } from '../../../src/main/ipc/handlers/permissions';
import { registerSecretsHandlers } from '../../../src/main/ipc/handlers/secrets';
import { registerSettingsHandlers } from '../../../src/main/ipc/handlers/settings';
import { registerSystemHandlers } from '../../../src/main/ipc/handlers/system';
import { registerWindowHandlers } from '../../../src/main/ipc/handlers/window';
import type { Handle, SenderInfo } from '../../../src/main/ipc/types';
import type { AppContext } from '../../../src/main/services';
import type { InvokeChannel } from '../../../src/shared/ipc-channels';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings';
import { fakeContext, memoryLogger } from './fakes';

type AnyHandler = (request: unknown, sender: SenderInfo) => unknown;

/** Collects handlers so tests can call them directly (validation is covered by the router tests). */
function collect(ctx: AppContext, ...modules: ((ctx: AppContext, handle: Handle) => void)[]) {
  const handlers = new Map<InvokeChannel, AnyHandler>();
  const handle: Handle = (channel, handler) => {
    handlers.set(channel, handler as AnyHandler);
  };
  modules.forEach((register) => register(ctx, handle));
  return (channel: InvokeChannel, request: unknown = undefined, sender: SenderInfo = { kind: 'dashboard', webContentsId: 1 }) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(request, sender);
  };
}

describe('core IPC handlers', () => {
  it('app:info describes this build', () => {
    // Arrange
    const call = collect(fakeContext(), registerAppHandlers);

    // Act
    const info = call('app:info') as Record<string, unknown>;

    // Assert
    expect(info).toMatchObject({ version: '2.0.0-test', platform: 'darwin', userDataPath: '/tmp/rt/user', isDev: false });
    expect(typeof info.arch).toBe('string');
  });

  it('settings:update applies the patch and explains invalid values in words', () => {
    // Arrange
    const ctx = fakeContext();
    const call = collect(ctx, registerSettingsHandlers);

    // Act
    const updated = call('settings:update', { patch: { leafy: { size: 'small' } } }) as typeof DEFAULT_SETTINGS;
    const invalid = () => call('settings:update', { patch: { voice: { endSilenceMs: 1 } } });

    // Assert
    expect(updated.leafy.size).toBe('small');
    expect(call('settings:get')).toBe(updated);
    expect(invalid).toThrow(/^That setting couldn't be saved: voice\.endSilenceMs — /);
  });

  it('secrets handlers delegate to the secrets service', () => {
    // Arrange
    const ctx = fakeContext();
    const call = collect(ctx, registerSecretsHandlers);

    // Act
    call('secrets:set', { id: 'groq', value: 'gsk_x' });
    call('secrets:clear', { id: 'groq' });
    call('secrets:status');

    // Assert
    expect(ctx.secrets.set).toHaveBeenCalledWith('groq', 'gsk_x');
    expect(ctx.secrets.clear).toHaveBeenCalledWith('groq');
    expect(ctx.secrets.status).toHaveBeenCalled();
  });

  it('permissions:openSettings opens the right pane and acknowledges', async () => {
    // Arrange
    const ctx = fakeContext();
    const call = collect(ctx, registerPermissionsHandlers);

    // Act
    const result = await call('permissions:openSettings', { kind: 'accessibility' });

    // Assert
    expect(ctx.permissions.openSettings).toHaveBeenCalledWith('accessibility');
    expect(result).toEqual({ ok: true });
  });

  it('window:open shows the dashboard route or the palette', () => {
    // Arrange
    const ctx = fakeContext();
    const call = collect(ctx, registerWindowHandlers);

    // Act
    call('window:open', { target: 'dashboard', route: '/history' });
    call('window:open', { target: 'palette', mode: 'voice' });

    // Assert
    expect(ctx.windows.dashboard.show).toHaveBeenCalledWith('/history');
    expect(ctx.windows.palette.show).toHaveBeenCalledWith('voice', null);
  });

  it('window:close hides the caller and window:minimize minimises only the dashboard', () => {
    // Arrange
    const ctx = fakeContext();
    const call = collect(ctx, registerWindowHandlers);
    const minimize = vi.fn();
    electron.BrowserWindow.fromWebContents.mockReturnValue({ minimize, isMinimizable: () => true } as never);

    // Act
    call('window:close', undefined, { kind: 'palette', webContentsId: 5 });
    call('window:minimize', undefined, { kind: 'dashboard', webContentsId: 1 });
    call('window:minimize', undefined, { kind: 'leafy', webContentsId: 3 });

    // Assert
    expect(ctx.windows.palette.hide).toHaveBeenCalled();
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(ctx.windows.leafy.hide).toHaveBeenCalled();
  });

  it('system:openExternal opens the link in the browser', async () => {
    // Arrange
    const call = collect(fakeContext(), registerSystemHandlers);

    // Act
    await call('system:openExternal', { url: 'https://codethecure.org' });

    // Assert
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://codethecure.org');
  });

  it('leafy and island handlers drive the windows service', () => {
    // Arrange
    const ctx = fakeContext();
    const call = collect(ctx, registerLeafyHandlers, registerIslandHandlers);

    // Act
    call('leafy:pointer', { interactive: true });
    call('leafy:moveTo', { x: 10, y: 20 });
    call('leafy:dragEnd');
    call('leafy:menu');
    const position = call('leafy:position');
    call('island:pointer', { interactive: false });

    // Assert
    expect(ctx.windows.leafy.setInteractive).toHaveBeenCalledWith(true);
    expect(ctx.windows.leafy.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.windows.leafy.persistPosition).toHaveBeenCalled();
    expect(ctx.windows.leafy.popupMenu).toHaveBeenCalled();
    expect(position).toEqual({ x: 10, y: 20, corner: 'right' });
    expect(ctx.windows.island.setInteractive).toHaveBeenCalledWith(false);
  });

  it('engine handlers mark ready, hand captures to voice without waiting, and relay claps', async () => {
    // Arrange
    const logger = memoryLogger();
    let finishPipeline: () => void = () => undefined;
    const ctx = fakeContext({ logger });
    vi.mocked(ctx.voice.onCapture).mockImplementation(() => new Promise<void>((resolve) => { finishPipeline = resolve; }));
    const claps = vi.fn();
    ctx.bus.on('clap', claps);
    const call = collect(ctx, registerEngineHandlers);
    const capture = {
      requestId: 'r1', reason: 'stopped', wav: new Uint8Array(4),
      stats: { durationMs: 1, speechMs: 1, segments: 1, pauseCount: 0, longPauseCount: 0, meanPauseMs: 0, maxPauseMs: 0, speechLevelDb: -20 },
    };

    // Act
    call('engine:ready');
    const captureResult = call('engine:capture', capture);
    call('engine:clap', { at: 123 });
    call('engine:voices', { voices: [{ name: 'Samantha', lang: 'en-US', isDefault: true }] });
    call('engine:error', { scope: 'mic', message: 'Microphone unplugged' });
    finishPipeline();

    // Assert
    expect(ctx.windows.engine.markReady).toHaveBeenCalled();
    expect(captureResult).toEqual({ ok: true });
    expect(ctx.voice.onCapture).toHaveBeenCalledWith(capture);
    expect(ctx.voice.onClap).toHaveBeenCalledWith(123);
    expect(claps).toHaveBeenCalledWith({ at: 123 });
    expect(ctx.voice.onEngineError).toHaveBeenCalledWith('mic', 'Microphone unplugged');
    expect(logger.entries.some((e) => e.meta?.count === 1)).toBe(true);
  });

  it('logs a failed voice pipeline instead of rejecting the engine', async () => {
    // Arrange
    const logger = memoryLogger();
    const ctx = fakeContext({ logger });
    vi.mocked(ctx.voice.onCapture).mockRejectedValue(new Error('stt down'));
    const call = collect(ctx, registerEngineHandlers);

    // Act
    call('engine:capture', { requestId: 'r2', reason: 'error', wav: null, stats: {} });
    await new Promise((resolve) => setImmediate(resolve));

    // Assert
    expect(logger.entries.some((e) => e.level === 'error' && e.meta?.requestId === 'r2')).toBe(true);
  });
});
