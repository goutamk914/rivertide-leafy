import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FnKeyEvent } from '../../../src/main/services';
import type { VoiceSnapshot } from '../../../src/shared/types';
import { createFakeContext, type FakeContextOptions } from '../agent/fake-context';

vi.mock('electron', () => ({ globalShortcut: {}, powerMonitor: {} }));

const { createHotkeysService, ACTIVITY_POLL_MS } = await import('../../../src/main/input/hotkeys');

function shortcuts(taken: readonly string[] = []) {
  const registered = new Map<string, () => void>();
  return {
    registered,
    api: {
      register: (accelerator: string, callback: () => void) => {
        if (taken.includes(accelerator)) return false;
        registered.set(accelerator, callback);
        return true;
      },
      unregister: (accelerator: string) => { registered.delete(accelerator); },
      isRegistered: (accelerator: string) => registered.has(accelerator),
    },
  };
}

function setup(options: { taken?: string[]; idle?: () => number; settings?: FakeContextOptions['settings'] } = {}) {
  let fnListener: (event: FnKeyEvent) => void = () => undefined;
  let snapshot: Partial<VoiceSnapshot> = { phase: 'idle', mode: null };
  const fake = createFakeContext({ settings: options.settings, os: { onFnKey: (listener) => { fnListener = listener; return () => undefined; } } });
  const voice = fake.ctx.voice as unknown as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; handleFnKey: ReturnType<typeof vi.fn>; snapshot: ReturnType<typeof vi.fn> };
  voice.snapshot.mockImplementation(() => snapshot);
  const keys = shortcuts(options.taken);
  const service = createHotkeysService(fake.ctx, { shortcuts: keys.api, idleSeconds: options.idle ?? (() => 10) });
  return { fake, voice, keys, service, fn: (event: FnKeyEvent) => fnListener(event), setSnapshot: (next: Partial<VoiceSnapshot>) => { snapshot = next; } };
}

afterEach(() => vi.useRealTimers());

describe('createHotkeysService', () => {
  it('registers the configured shortcuts and reports their status', () => {
    const { service, keys } = setup();
    service.start();
    expect([...keys.registered.keys()]).toEqual(['CommandOrControl+Shift+Space', 'CommandOrControl+Shift+L', 'CommandOrControl+Shift+D']);
    expect(service.status().every((status) => status.registered)).toBe(true);
  });

  it('reports shortcuts another app already owns', () => {
    const { service } = setup({ taken: ['CommandOrControl+Shift+L'] });
    service.start();
    expect(service.status().find((status) => status.action === 'command')).toEqual({ action: 'command', accelerator: 'CommandOrControl+Shift+L', registered: false });
  });

  it('toggles voice command and dictation, and opens the palette', () => {
    const { service, keys, voice, fake, setSnapshot } = setup();
    service.start();
    keys.registered.get('CommandOrControl+Shift+L')!();
    expect(voice.start).toHaveBeenCalledWith('command', 'hotkey');
    setSnapshot({ phase: 'listening', mode: 'command' });
    keys.registered.get('CommandOrControl+Shift+L')!();
    expect(voice.stop).toHaveBeenCalled();
    keys.registered.get('CommandOrControl+Shift+Space')!();
    expect(fake.ctx.windows.palette.show).toHaveBeenCalledWith('search');
  });

  it('forwards fn keys to the voice service', () => {
    const { service, voice, fn } = setup();
    service.start();
    const event = { down: true, t: 5, mods: { ctrl: true, shift: false, alt: false, cmd: false } };
    fn(event);
    expect(voice.handleFnKey).toHaveBeenCalledWith(event);
  });

  it('grabs Escape only while voice is busy', () => {
    const { service, keys, voice, fake } = setup();
    service.start();
    fake.bus.emit('voice:snapshot', { phase: 'thinking' } as VoiceSnapshot);
    expect(keys.registered.has('Escape')).toBe(true);
    keys.registered.get('Escape')!();
    expect(voice.cancel).toHaveBeenCalled();
    fake.bus.emit('voice:snapshot', { phase: 'idle' } as VoiceSnapshot);
    expect(keys.registered.has('Escape')).toBe(false);
  });

  it('sends clap settings to the engine and reports activity changes only', async () => {
    vi.useFakeTimers();
    let idle = 10;
    const { service, fake } = setup({ settings: { clap: { enabled: true } }, idle: () => idle });
    service.start();
    expect(fake.engine[0]).toEqual({ type: 'clap', enabled: true, sensitivity: 'medium' });
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_MS);
    idle = 0;
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_MS * 3);
    expect(fake.engine.filter((command) => command.type === 'activity')).toEqual([{ type: 'activity', userActive: false }, { type: 'activity', userActive: true }]);
    service.stop();
  });

  it('re-registers on reload and cleans up on stop', () => {
    const { service, keys, fake } = setup();
    service.start();
    fake.setSettings({ hotkeys: { dictate: 'CommandOrControl+Alt+D' } });
    service.reload();
    expect(keys.registered.has('CommandOrControl+Alt+D')).toBe(true);
    expect(keys.registered.has('CommandOrControl+Shift+D')).toBe(false);
    service.stop();
    expect(keys.registered.size).toBe(0);
  });
});
