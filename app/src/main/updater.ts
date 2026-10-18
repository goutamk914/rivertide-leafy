/**
 * Automatic updates from GitHub releases (CodeTheCure/rivertide-electron) with electron-updater.
 *
 * Packaged builds only: electron-builder writes `Contents/Resources/app-update.yml` from the
 * `publish` block in electron-builder.yml, and only published (not draft) releases are offered.
 * Updates download in the background and install the next time Rivertide quits; a notification
 * says when one is ready. On macOS Squirrel.Mac installs the release's zip and only accepts an
 * update signed by the same Developer ID, so an ad-hoc local build just logs an error.
 */
import type { Logger } from './services';

/** Leaves startup (helper, windows, stores) alone before touching the network. */
export const UPDATE_CHECK_DELAY_MS = 30_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const UPDATE_NOTIFICATION = Object.freeze({
  title: 'A Rivertide update is ready',
  body: 'Version {version} will be installed the next time you quit Rivertide.',
});

/** electron-updater's logger shape (messages are usually strings, sometimes errors). */
export interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug?(message: string): void;
}

/** The parts of electron-updater's `autoUpdater` used here (injectable for tests). */
export interface UpdaterLike {
  logger: UpdaterLogger | null;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdatesAndNotify(notification?: { title: string; body: string }): Promise<unknown>;
  on(event: 'error', listener: (error: Error, message?: string) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { readonly version: string }) => void): unknown;
}

export interface AutoUpdateOptions {
  /** Electron's `app.isPackaged`. */
  readonly isPackaged: boolean;
  readonly logger: Logger;
  readonly loadUpdater?: () => Promise<UpdaterLike>;
}

const loadElectronUpdater = async (): Promise<UpdaterLike> => (await import('electron-updater')).autoUpdater;

function toUpdaterLogger(log: Logger): UpdaterLogger {
  const text = (message: unknown): string => (message instanceof Error ? message.message : String(message));
  return {
    info: (message) => log.info(text(message)),
    warn: (message) => log.warn(text(message)),
    error: (message) => log.error(text(message)),
    debug: (message) => log.debug(message),
  };
}

/** Configures electron-updater's singleton once (it is a library object we own, not shared state). */
function configure(updater: UpdaterLike, log: Logger, onDownloaded: () => void): UpdaterLike {
  updater.logger = toUpdaterLogger(log.child('electron-updater'));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  // An 'error' event with no listener would throw from inside electron-updater.
  updater.on('error', (error) => log.warn('updater error', { error }));
  updater.on('update-downloaded', (info) => {
    log.info('update downloaded', { version: info.version });
    onDownloaded();
  });
  return updater;
}

/** Starts background update checks; returns a function that stops them. */
export function startAutoUpdates(options: AutoUpdateOptions): () => void {
  const log = options.logger;
  if (!options.isPackaged) {
    log.info('updates are off for unpackaged builds');
    return () => undefined;
  }
  const loadUpdater = options.loadUpdater ?? loadElectronUpdater;
  let ready: Promise<UpdaterLike> | null = null;
  let stopped = false;
  let first: ReturnType<typeof setTimeout> | undefined;
  let every: ReturnType<typeof setInterval> | undefined;

  const stop = (): void => {
    stopped = true;
    clearTimeout(first);
    clearInterval(every);
  };

  const updater = (): Promise<UpdaterLike> => {
    // Once an update is staged, checking again would re-stage it and repeat the notification;
    // it installs when Rivertide quits.
    ready ??= loadUpdater()
      .then((loaded) => configure(loaded, log, stop))
      .catch((error: unknown) => {
        ready = null;
        throw error;
      });
    return ready;
  };

  const check = async (): Promise<void> => {
    if (stopped) return;
    try {
      await (await updater()).checkForUpdatesAndNotify(UPDATE_NOTIFICATION);
    } catch (error) {
      log.warn('update check failed', { error });
    }
  };

  first = setTimeout(() => void check(), UPDATE_CHECK_DELAY_MS);
  every = setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
  return stop;
}
