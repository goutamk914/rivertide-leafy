/**
 * Windows service (`ctx.windows`): owns the five windows, maps IPC senders to window kinds and
 * routes main → renderer events. Overlays, palette and engine are created in `start()`; the
 * dashboard is created on first use.
 */
import { app, type BrowserWindow } from 'electron';
import type { EngineCommand, EventPayload } from '../../shared/ipc';
import type { EventChannel } from '../../shared/ipc-channels';
import type { Toast } from '../../shared/types';
import { guarded } from '../guard';
import type { AppContext, WindowKind, WindowsService } from '../services';
import { sendIfLoaded, sendWhenLoaded, type WindowEnv } from './common';
import { createDashboard, type DashboardController } from './dashboard';
import { createEngine, type EngineController } from './engine';
import { createIsland, type IslandController } from './island';
import { createLeafy, LEAFY_STORE, validateLeafyFile, type LeafyController, type LeafyFile } from './leafy';
import { leafyMenuTemplate, type LeafyMenuActions } from './leafy-menu';
import { createPalette, type PaletteController } from './palette';
import { routeFor, VISIBLE_ONLY_EVENTS } from './routing';

export interface WindowsServiceOptions {
  /** Vite dev server origin in development; null loads the bundled pages over app://. */
  readonly devServerUrl: string | null;
}

/** The service plus lifecycle hooks only bootstrap/index use. */
export interface WindowsRuntime extends WindowsService {
  destroyAll(): void;
}

interface Overlays {
  readonly island: IslandController;
  readonly leafy: LeafyController;
  readonly palette: PaletteController;
  readonly engine: EngineController;
}

const MAX_EARLY_TOASTS = 10;

export function createWindowsService(ctx: AppContext, options: WindowsServiceOptions = { devServerUrl: null }): WindowsRuntime {
  const kinds = new Map<number, WindowKind>();
  let overlays: Overlays | null = null;
  let dashboardCtl: DashboardController | null = null;
  let quitting = false;
  let earlyToasts: readonly Toast[] = [];
  let earlyEngine: readonly EngineCommand[] = [];
  const log = () => ctx.logger.child('windows');

  const env = (): WindowEnv => ({
    isMac: ctx.platform === 'darwin',
    devServerUrl: options.devServerUrl,
    logger: ctx.logger,
    register(kind: WindowKind, win: BrowserWindow) {
      const id = win.webContents.id;
      kinds.set(id, kind);
      win.webContents.once('destroyed', () => kinds.delete(id));
    },
  });

  const replayEarlyToasts = (win: BrowserWindow): void => {
    earlyToasts.forEach((toast) => sendWhenLoaded(win, 'toast', toast));
  };

  const dashboard = (): DashboardController => {
    dashboardCtl ??= createDashboard(env(), () => quitting, replayEarlyToasts);
    return dashboardCtl;
  };

  const requireOverlays = (what: string): Overlays | null => {
    if (!overlays) log().warn('window used before windows.start()', { what });
    return overlays;
  };

  const windowOf = (kind: WindowKind): BrowserWindow | null => {
    if (kind === 'dashboard') return dashboardCtl?.current() ?? null;
    return overlays?.[kind].current() ?? null;
  };

  const leafyActions: LeafyMenuActions = {
    talk: () => ctx.voice.start('command', 'leafy'),
    search: () => service.palette.show('search'),
    openDashboard: (route) => service.dashboard.show(route),
    hideLeafy: () => ctx.settings.update({ leafy: { visible: false } }),
    quit: () => app.quit(),
  };

  const broadcast = <C extends EventChannel>(channel: C, payload: EventPayload<C>): void => {
    if (channel === 'engine:command') {
      service.engine.send(payload as unknown as EngineCommand);
      return;
    }
    if (channel === 'toast' && !overlays) {
      earlyToasts = [...earlyToasts, payload as unknown as Toast].slice(-MAX_EARLY_TOASTS);
      return;
    }
    for (const kind of routeFor(channel)) {
      const win = windowOf(kind);
      if (!win || (VISIBLE_ONLY_EVENTS.has(channel) && !win.isVisible())) continue;
      if (channel === 'toast') sendWhenLoaded(win, channel, payload);
      else sendIfLoaded(win, channel, payload);
    }
  };

  const createOverlays = (): Overlays => {
    const windowEnv = env();
    const engine = createEngine(windowEnv);
    const island = createIsland(windowEnv);
    const palette = createPalette(windowEnv, () => dashboardCtl?.isVisible() ?? false);
    const leafy = createLeafy({
      env: windowEnv,
      size: () => ctx.settings.get().leafy.size,
      store: ctx.openStore<LeafyFile>(LEAFY_STORE, { defaults: {}, validate: validateLeafyFile }),
      menuTemplate: () => leafyMenuTemplate(leafyActions, log()),
    });
    leafy.current()?.once('ready-to-show', guarded(log(), 'show leafy', () => {
      if (ctx.settings.get().leafy.visible) leafy.show();
    }));
    leafy.current()?.webContents.once('did-finish-load', () => {
      const win = leafy.current();
      if (win) replayEarlyToasts(win);
    });
    return { engine, island, palette, leafy };
  };

  const service: WindowsRuntime = {
    async start() {
      if (overlays) return;
      app.on('before-quit', () => {
        quitting = true;
      });
      overlays = createOverlays();
      const pending = earlyEngine;
      earlyEngine = [];
      pending.forEach((command) => overlays?.engine.send(command));
      log().info('windows started');
    },
    dashboard: {
      show: (route) => dashboard().show(route),
      hide: () => dashboardCtl?.hide(),
      isVisible: () => dashboardCtl?.isVisible() ?? false,
    },
    palette: {
      show: (mode, query) => requireOverlays('palette.show')?.palette.show(mode, query ?? null),
      hide: () => overlays?.palette.hide(),
      isVisible: () => overlays?.palette.isVisible() ?? false,
      resize: (height) => overlays?.palette.resize(height),
    },
    island: {
      show: () => requireOverlays('island.show')?.island.show(),
      hide: () => overlays?.island.hide(),
      setInteractive: (interactive) => overlays?.island.setInteractive(interactive),
    },
    leafy: {
      show: () => requireOverlays('leafy.show')?.leafy.show(),
      hide: () => overlays?.leafy.hide(),
      isVisible: () => overlays?.leafy.isVisible() ?? false,
      setInteractive: (interactive) => overlays?.leafy.setInteractive(interactive),
      moveTo: (x, y) => overlays?.leafy.moveTo(x, y),
      persistPosition: () => overlays?.leafy.persistPosition(),
      position: () => overlays?.leafy.position() ?? { x: 0, y: 0, corner: 'right' },
      popupMenu: () => overlays?.leafy.popupMenu(),
      applySize: (size) => overlays?.leafy.applySize(size),
    },
    engine: {
      send(command) {
        if (overlays) overlays.engine.send(command);
        else earlyEngine = [...earlyEngine, command];
      },
      isReady: () => overlays?.engine.isReady() ?? false,
      markReady: () => overlays?.engine.markReady(),
    },
    broadcast,
    kindOf: (webContentsId) => kinds.get(webContentsId) ?? null,
    destroyAll() {
      // Panels left alive during quit can crash Electron on macOS: destroy them explicitly.
      overlays?.island.destroy();
      overlays?.leafy.destroy();
      overlays?.palette.destroy();
      overlays?.engine.destroy();
      dashboardCtl?.destroy();
    },
  };
  return service;
}
