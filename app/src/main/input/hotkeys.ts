/**
 * `createHotkeysService(ctx)` — global shortcuts (palette, voice command, dictation), Esc while a
 * voice session is busy, fn-key forwarding from the native helper, and clap-detector settings plus
 * keyboard/mouse activity for the engine's clap gate. Registration failures are reported, never silent.
 */
import { globalShortcut, powerMonitor } from 'electron';
import type { HotkeyStatus, VoiceMode, VoicePhase } from '../../shared/types';
import type { Settings } from '../../shared/settings';
import type { AppContext, HotkeysService } from '../services';

export const ACTIVITY_POLL_MS = 500;
const ENGINE_READY_POLL_MS = 500;
const ENGINE_READY_MAX_TRIES = 120;
const ESCAPE = 'Escape';
const CANCELLABLE: ReadonlySet<VoicePhase> = new Set(['listening', 'transcribing', 'thinking', 'acting', 'confirming', 'speaking']);

export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered(accelerator: string): boolean;
}

export interface HotkeyDeps {
  readonly shortcuts: ShortcutApi;
  readonly idleSeconds: () => number;
}

const electronDeps = (): HotkeyDeps => ({ shortcuts: globalShortcut, idleSeconds: () => powerMonitor.getSystemIdleTime() });

type Action = HotkeyStatus['action'];
const ACTIONS: readonly Action[] = ['palette', 'command', 'dictate'];

export function createHotkeysService(ctx: AppContext, depsOverride?: HotkeyDeps): HotkeysService {
  let deps: HotkeyDeps | null = depsOverride ?? null;
  const api = () => (deps ??= electronDeps());
  const log = () => ctx.logger.child('hotkeys');
  let statuses: readonly HotkeyStatus[] = [];
  let ours: readonly string[] = [];
  let escapeOn = false;
  let activityTimer: NodeJS.Timeout | null = null;
  let lastActive: boolean | null = null;
  let lastClap = '';
  let unsubscribe: (() => void)[] = [];

  function toggle(mode: VoiceMode): void {
    const snapshot = ctx.voice.snapshot();
    if (snapshot.phase === 'listening' && snapshot.mode === mode) ctx.voice.stop();
    else ctx.voice.start(mode, 'hotkey');
  }

  const handlers: Readonly<Record<Action, () => void>> = {
    palette: () => ctx.windows.palette.show('search'),
    command: () => toggle('command'),
    dictate: () => toggle('dictate'),
  };

  function tryRegister(accelerator: string, callback: () => void): boolean {
    try {
      return api().shortcuts.register(accelerator, callback) && api().shortcuts.isRegistered(accelerator);
    } catch (error) {
      log().warn('invalid shortcut', { accelerator, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  function unregisterOurs(): void {
    ours.forEach((accelerator) => api().shortcuts.unregister(accelerator));
    ours = [];
  }

  function registerAll(): readonly HotkeyStatus[] {
    unregisterOurs();
    const config = ctx.settings.get().hotkeys;
    const registered: string[] = [];
    statuses = ACTIONS.map((action) => {
      const accelerator = config[action].trim();
      if (!accelerator) return { action, accelerator, registered: false };
      const ok = !registered.includes(accelerator) && tryRegister(accelerator, handlers[action]);
      if (ok) registered.push(accelerator);
      else log().warn('shortcut not registered (in use by another app or invalid)', { action, accelerator });
      return { action, accelerator, registered: ok };
    });
    ours = registered;
    return statuses;
  }

  /** Esc cancels voice activity, but is only grabbed while something is in flight. */
  function syncEscape(phase: VoicePhase): void {
    const wanted = CANCELLABLE.has(phase);
    if (wanted && !escapeOn) escapeOn = tryRegister(ESCAPE, () => ctx.voice.cancel());
    else if (!wanted && escapeOn) {
      api().shortcuts.unregister(ESCAPE);
      escapeOn = false;
    }
  }

  function sendClapConfig(clap: Settings['clap'], attempt = 0): void {
    const key = JSON.stringify([clap.enabled, clap.sensitivity]);
    if (key === lastClap) return;
    if (!ctx.windows.engine.isReady()) {
      if (attempt < ENGINE_READY_MAX_TRIES) setTimeout(() => sendClapConfig(ctx.settings.get().clap, attempt + 1), ENGINE_READY_POLL_MS);
      return;
    }
    lastClap = key;
    ctx.windows.engine.send({ type: 'clap', enabled: clap.enabled, sensitivity: clap.sensitivity });
    syncActivityPolling(clap.enabled);
  }

  /** While clap detection is on, tell the engine when the user is typing or using the mouse. */
  function syncActivityPolling(enabled: boolean): void {
    if (!enabled) {
      if (activityTimer) clearInterval(activityTimer);
      activityTimer = null;
      lastActive = null;
      return;
    }
    if (activityTimer) return;
    activityTimer = setInterval(() => {
      const userActive = api().idleSeconds() < 1;
      if (userActive === lastActive) return;
      lastActive = userActive;
      ctx.windows.engine.send({ type: 'activity', userActive });
    }, ACTIVITY_POLL_MS);
  }

  return {
    start() {
      registerAll();
      unsubscribe = [
        ctx.os.onFnKey((event) => ctx.voice.handleFnKey(event)),
        ctx.bus.on('voice:snapshot', (snapshot) => syncEscape(snapshot.phase)),
        ctx.bus.on('settings:changed', (settings) => sendClapConfig(settings.clap)),
      ];
      sendClapConfig(ctx.settings.get().clap);
      log().info('hotkeys ready', { registered: statuses.filter((status) => status.registered).map((status) => status.action) });
    },
    stop() {
      unregisterOurs();
      if (escapeOn) api().shortcuts.unregister(ESCAPE);
      escapeOn = false;
      unsubscribe.forEach((off) => off());
      unsubscribe = [];
      syncActivityPolling(false);
    },
    reload: registerAll,
    status: () => statuses,
  };
}
