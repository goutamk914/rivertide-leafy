/**
 * Electron entry point — app lifecycle only. Everything else is composed in bootstrap.ts.
 */
import { app, dialog, globalShortcut } from 'electron';
import { join } from 'node:path';
import { bootstrap, type Runtime } from './bootstrap';
import { registerAppScheme } from './security';

const APP_USER_MODEL_ID = 'org.codethecure.rivertide';
const QUIT_FLUSH_TIMEOUT_MS = 3000;
const DEV_SERVER_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?\/?$/;

const isDev = process.env.NODE_ENV !== 'production';

/** Only honoured for unpackaged builds and only for a local http origin. */
function resolveDevServerUrl(): string | null {
  const raw = process.env.RIVERTIDE_DEV_SERVER_URL;
  if (!raw || app.isPackaged || !DEV_SERVER_PATTERN.test(raw)) return null;
  return raw.replace(/\/+$/, '');
}

let runtime: Runtime | null = null;
let readyToQuit = false;

function reportError(label: string, error: unknown): void {
  if (runtime) runtime.ctx.logger.child('process').error(label, { error });
  else process.stderr.write(`${label}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
}

async function start(): Promise<void> {
  runtime = await bootstrap({ isDev, devServerUrl: resolveDevServerUrl(), distDir: join(app.getAppPath(), 'dist') });
  if (!runtime.ctx.settings.get().onboarded) runtime.ctx.windows.dashboard.show('/onboarding');
}

function failStartup(error: unknown): void {
  reportError('Rivertide could not start', error);
  const detail = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('Rivertide could not start', `${detail}\n\nPlease quit and open Rivertide again. If this keeps happening, see the log in ~/Library/Logs/Rivertide.`);
  app.exit(1);
}

/** Holds the first quit until every store is on disk (bounded, so quitting can never hang). */
function onBeforeQuit(event: Electron.Event): void {
  if (readyToQuit || !runtime) return;
  event.preventDefault();
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS));
  Promise.race([runtime.flushAll(), timeout])
    .catch((error: unknown) => reportError('saving before quit failed', error))
    .finally(() => {
      readyToQuit = true;
      app.quit();
    });
}

function onWillQuit(): void {
  globalShortcut.unregisterAll();
  if (!runtime) return;
  const { ctx } = runtime;
  const steps: readonly [string, () => void][] = [
    ['os.stop', () => ctx.os.stop()],
    ['reminders.stop', () => ctx.reminders.stop()],
    ['hotkeys.stop', () => ctx.hotkeys.stop()],
    ['shutdown', () => runtime?.shutdown()],
  ];
  for (const [label, step] of steps) {
    try {
      step();
    } catch (error) {
      reportError(`${label} failed during quit`, error);
    }
  }
}

function main(): void {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  app.on('second-instance', () => runtime?.ctx.windows.dashboard.show());
  app.on('activate', () => runtime?.ctx.windows.dashboard.show());
  // Rivertide lives in the tray and Leafy: closing the last window never quits.
  app.on('window-all-closed', () => undefined);
  app.on('before-quit', onBeforeQuit);
  app.on('will-quit', onWillQuit);
  app.on('render-process-gone', (_event, _contents, details) => reportError('renderer process gone', details));
  app.on('child-process-gone', (_event, details) => reportError('child process gone', details));
  process.on('uncaughtException', (error) => reportError('uncaught exception', error));
  process.on('unhandledRejection', (reason) => reportError('unhandled rejection', reason));
  app.whenReady().then(start).catch(failStartup);
}

// Development keeps its own data folder so experiments never touch real history or keys.
if (isDev) app.setPath('userData', join(app.getPath('appData'), 'Rivertide Dev'));
registerAppScheme();

if (app.requestSingleInstanceLock()) main();
else app.quit();
