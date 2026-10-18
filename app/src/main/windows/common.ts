/**
 * Secure defaults shared by every Rivertide window: sandboxed renderer, context isolation, our
 * preload only, crash recovery, and helpers for sending events once a page has loaded.
 */
import { BrowserWindow, type BrowserWindowConstructorOptions, type WebPreferences } from 'electron';
import { join } from 'node:path';
import type { EventPayload } from '../../shared/ipc';
import type { EventChannel } from '../../shared/ipc-channels';
import type { Logger, WindowKind } from '../services';
import type { Size } from './geometry';

export const APP_SCHEME = 'app';
export const APP_HOST = 'rivertide';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export type PageName = 'main' | 'island' | 'leafy' | 'palette' | 'engine';

export const PAGE_FOR_KIND: Readonly<Record<WindowKind, PageName>> = {
  dashboard: 'main',
  island: 'island',
  leafy: 'leafy',
  palette: 'palette',
  engine: 'engine',
};

const CRASH_WINDOW_MS = 60_000;
const MAX_RELOADS_PER_WINDOW = 3;
const RELOAD_DELAY_MS = 1000;

export interface WindowEnv {
  readonly isMac: boolean;
  readonly devServerUrl: string | null;
  readonly logger: Logger;
  /** Records which kind of window owns a webContents (for IPC sender checks). */
  readonly register: (kind: WindowKind, win: BrowserWindow) => void;
}

export function pageUrl(page: PageName, devServerUrl: string | null): string {
  const base = devServerUrl ? devServerUrl.replace(/\/+$/, '') : APP_ORIGIN;
  return `${base}/${page}.html`;
}

/** The bundled preload sits next to main.cjs in dist-electron/. */
export function preloadPath(): string {
  return join(__dirname, 'preload.cjs');
}

export function secureWebPreferences(extra: Partial<WebPreferences> = {}): WebPreferences {
  return {
    spellcheck: false,
    ...extra,
    preload: preloadPath(),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
  };
}

/** Frameless, transparent, click-through, never-focused overlay (island, Leafy). */
export function overlayOptions(isMac: boolean, size: Size): BrowserWindowConstructorOptions {
  return {
    width: size.width,
    height: size.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    acceptFirstMouse: true,
    ...(isMac ? { type: 'panel', hiddenInMissionControl: true } : {}),
  };
}

/** Always-on-top on every Space (including full-screen apps) and click-through by default. */
export function applyOverlayBehaviour(win: BrowserWindow, level: 'floating' | 'screen-saver'): void {
  win.setAlwaysOnTop(true, level);
  // skipTransformProcessType avoids the Dock icon flicker this call otherwise causes on macOS.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: true });
}

function watchRenderer(env: WindowEnv, kind: WindowKind, win: BrowserWindow): void {
  const log = env.logger.child(`window:${kind}`);
  let reloads: number[] = [];
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('renderer exited', { reason: details.reason, exitCode: details.exitCode });
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    reloads = [...reloads.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (reloads.length > MAX_RELOADS_PER_WINDOW) {
      log.error('renderer keeps crashing; not reloading again for now');
      return;
    }
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload();
    }, RELOAD_DELAY_MS);
  });
  win.webContents.on('unresponsive', () => log.warn('renderer is not responding'));
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) log.error('page failed to load', { code, description, url });
  });
  win.webContents.on('preload-error', (_event, path, error) => log.error('preload failed', { path, error }));
}

/** Creates a sandboxed window for `kind` and starts loading its page. */
export function createSecureWindow(
  env: WindowEnv,
  kind: WindowKind,
  options: BrowserWindowConstructorOptions,
  prefs: Partial<WebPreferences> = {},
): BrowserWindow {
  const win = new BrowserWindow({ ...options, show: false, webPreferences: secureWebPreferences(prefs) });
  env.register(kind, win);
  watchRenderer(env, kind, win);
  win.loadURL(pageUrl(PAGE_FOR_KIND[kind], env.devServerUrl)).catch((error: unknown) => {
    env.logger.child(`window:${kind}`).error('could not load page', { error });
  });
  return win;
}

const isUsable = (win: BrowserWindow | null): win is BrowserWindow =>
  win !== null && !win.isDestroyed() && !win.webContents.isDestroyed() && !win.webContents.isCrashed();

/** Sends now if the page is loaded; drops the event otherwise (for high-rate or state events). */
export function sendIfLoaded<C extends EventChannel>(win: BrowserWindow | null, channel: C, payload: EventPayload<C>): boolean {
  if (!isUsable(win) || win.webContents.isLoadingMainFrame()) return false;
  win.webContents.send(channel, payload);
  return true;
}

/** Sends now, or once the page finishes loading (for one-off commands like `navigate`). */
export function sendWhenLoaded<C extends EventChannel>(win: BrowserWindow | null, channel: C, payload: EventPayload<C>): void {
  if (!isUsable(win)) return;
  if (!win.webContents.isLoadingMainFrame()) {
    win.webContents.send(channel, payload);
    return;
  }
  win.webContents.once('did-finish-load', () => {
    if (isUsable(win)) win.webContents.send(channel, payload);
  });
}
