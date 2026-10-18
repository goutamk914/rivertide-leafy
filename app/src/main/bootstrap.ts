/**
 * Composition root: builds the AppContext from core services and every feature factory (at the
 * fixed paths listed in services.ts), installs security, registers IPC, starts services in order
 * and wires background jobs. index.ts only handles the app lifecycle around this.
 */
import { app, session } from 'electron';
import { join } from 'node:path';
import { createAgentService } from './agent';
import { createLlmRouter } from './ai/llm/router';
import { createSttService } from './ai/stt';
import { createInsightsService } from './analytics';
import { createBus } from './bus';
import { createChatService } from './chat';
import { assembleContext, startServices, wireBackgroundJobs, type ServiceFactories } from './compose';
import { createHistoryRepository } from './data/history';
import { createNotesService } from './data/notes';
import { createHotkeysService } from './input/hotkeys';
import { registerIpc } from './ipc/register';
import { createKnowledgeService } from './knowledge';
import { createDictionaryService } from './knowledge/dictionary';
import { createDocumentsService } from './knowledge/documents';
import { createSearchIndex } from './knowledge/search-index';
import { createLogger } from './logger';
import { installAppMenu } from './menu';
import { createOsServices } from './os';
import { createPaletteService } from './palette';
import { createPaths, ensureDirectories, normalizePlatform } from './paths';
import { createPermissionsService } from './permissions';
import { createRemindersService } from './scheduler';
import { createSecretsService } from './secrets';
import {
  appOrigin, installAppProtocol, installDevCsp, installNavigationGuards, installPermissionHandlers,
} from './security';
import type { AppContext, Logger } from './services';
import { createSettingsService } from './settings-service';
import { createStoreRegistry } from './store/json-store';
import { createTray, type TrayHandle } from './tray';
import { startAutoUpdates } from './updater';
import { createVoiceService } from './voice';
import { createWakeWord, type WakeWordService } from './wake';
import { createWindowsService, type WindowsRuntime } from './windows';
import { forwardBusToWindows } from './windows/routing';

export const LOG_FILE = 'rivertide.log';

export interface BootstrapOptions {
  readonly isDev: boolean;
  /** Vite dev server (development only); null serves the built renderer over app://. */
  readonly devServerUrl: string | null;
  /** The built renderer (`dist/`). */
  readonly distDir: string;
}

export interface Runtime {
  readonly ctx: AppContext;
  /** Writes every pending store change to disk. */
  flushAll(): Promise<void>;
  /** Unwires jobs and destroys the tray and every window (call from `will-quit`). */
  shutdown(): void;
}

const FEATURE_FACTORIES = {
  createLlmRouter,
  createSttService,
  createOsServices,
  createVoiceService,
  createAgentService,
  createHotkeysService,
  createHistoryRepository,
  createKnowledgeService,
  createDictionaryService,
  createDocumentsService,
  createSearchIndex,
  createChatService,
  createNotesService,
  createRemindersService,
  createInsightsService,
  createPaletteService,
} satisfies Omit<ServiceFactories, 'createSettingsService' | 'createSecretsService' | 'createWindowsService' | 'createPermissionsService'>;

function installSecurity(ctx: AppContext, options: BootstrapOptions): string {
  const allowedOrigin = appOrigin(options.devServerUrl);
  installNavigationGuards(allowedOrigin, ctx.logger);
  installPermissionHandlers(session.defaultSession, ctx.windows.kindOf, allowedOrigin, ctx.logger);
  if (options.devServerUrl) installDevCsp(session.defaultSession, options.devServerUrl);
  else installAppProtocol(options.distDir, ctx.logger);
  return allowedOrigin;
}

function loginItemSetter(log: Logger): (openAtLogin: boolean) => void {
  return (openAtLogin) => {
    if (!app.isPackaged) {
      log.info('login item not changed in development', { openAtLogin });
      return;
    }
    app.setLoginItemSettings({ openAtLogin });
  };
}

function startWakeWord(ctx: AppContext, wakeWord: WakeWordService): void {
  try {
    wakeWord.start();
  } catch (error) {
    ctx.logger.child('wake').error('wake word could not start', { error });
  }
}

function startTray(ctx: AppContext): TrayHandle | null {
  try {
    return createTray(ctx);
  } catch (error) {
    ctx.logger.child('tray').error('tray could not be created', { error });
    return null;
  }
}

export async function bootstrap(options: BootstrapOptions): Promise<Runtime> {
  const paths = createPaths(app, process.resourcesPath);
  await ensureDirectories(paths);
  const logger = createLogger({ file: join(paths.logs, LOG_FILE), isDev: options.isDev });
  logger.info('Rivertide starting', { version: app.getVersion(), isDev: options.isDev });
  const bus = createBus((event, error) => logger.child('bus').error('listener failed', { event, error }));
  const stores = createStoreRegistry({ dir: paths.data, logger: logger.child('store'), bus });

  let windows: WindowsRuntime | null = null;
  const ctx = assembleContext(
    {
      isDev: options.isDev,
      platform: normalizePlatform(process.platform),
      version: app.getVersion(),
      paths,
      logger,
      bus,
      openStore: stores.openStore,
    },
    {
      ...FEATURE_FACTORIES,
      createSettingsService,
      createSecretsService,
      createPermissionsService,
      createWindowsService: (c) => {
        windows = createWindowsService(c, { devServerUrl: options.devServerUrl });
        return windows;
      },
    },
  );

  const allowedOrigin = installSecurity(ctx, options);
  installAppMenu(ctx, app.getName());
  const stopForwarding = forwardBusToWindows(ctx.bus, ctx.windows.broadcast);
  // Handlers go in before any window loads, so a page's first invoke never races registration.
  const wakeWord = createWakeWord(ctx, { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });
  registerIpc(ctx, { allowedOrigin, flushAll: stores.flushAll, closeStores: stores.closeAll, onWakeAudio: wakeWord.pushAudio });
  await startServices(ctx);
  startWakeWord(ctx, wakeWord);
  const tray = startTray(ctx);
  const setLoginItem = loginItemSetter(logger.child('login'));
  const stopJobs = wireBackgroundJobs(ctx, { setLoginItem });
  if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== ctx.settings.get().system.launchAtLogin) {
    setLoginItem(ctx.settings.get().system.launchAtLogin);
  }
  logger.info('Rivertide ready');
  const stopUpdates = startAutoUpdates({ isPackaged: app.isPackaged, logger: logger.child('updater') });

  return {
    ctx,
    flushAll: stores.flushAll,
    shutdown() {
      stopUpdates();
      wakeWord.stop();
      stopJobs();
      stopForwarding();
      tray?.destroy();
      (windows as WindowsRuntime | null)?.destroyAll();
    },
  };
}
