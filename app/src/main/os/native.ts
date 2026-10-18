/**
 * Wiring for the native macOS helper (`./helper` is the protocol client, owned elsewhere):
 * binary location, lifecycle, status for the permissions UI and fn-key fan-out.
 */
import { join } from 'node:path';
import type { FnKeyEvent, Logger } from '../services';
import { NativeHelper, type HelperLogger } from './helper';

export type HelperStatus = 'running' | 'unavailable' | 'stopped' | 'unsupported';

export interface HelperPathInput {
  /** Electron's `app.isPackaged` — NOT the dev-server flag (an unpackaged `electron .` run is not packaged). */
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
}

/** Unpackaged: `<app.getAppPath()>/native/rivertide-helper`; packaged: `<resourcesPath>/native/rivertide-helper`. */
export function helperBinaryPath(input: HelperPathInput): string {
  return input.isPackaged
    ? join(input.resourcesPath, 'native', 'rivertide-helper')
    : join(input.appPath, 'native', 'rivertide-helper');
}

export interface HelperHost {
  readonly helper: NativeHelper | null;
  start(): void;
  stop(): void;
  status(): HelperStatus;
  isReady(): boolean;
  onFnKey(listener: (event: FnKeyEvent) => void): () => void;
}

export function toHelperLogger(logger: Logger): HelperLogger {
  const meta = (value: unknown): Record<string, unknown> | undefined =>
    value === undefined ? undefined : typeof value === 'object' && value !== null ? { ...(value as Record<string, unknown>) } : { detail: String(value) };
  return {
    info: (message, value) => logger.info(message, meta(value)),
    warn: (message, value) => logger.warn(message, meta(value)),
    error: (message, value) => logger.error(message, meta(value)),
  };
}

export interface HelperHostOptions {
  readonly platform: NodeJS.Platform;
  readonly binaryPath: string;
  readonly logger: Logger;
  readonly createHelper?: (binaryPath: string, logger: HelperLogger) => NativeHelper;
}

export function createHelperHost(options: HelperHostOptions): HelperHost {
  const log = options.logger.child('helper');
  if (options.platform !== 'darwin') return unsupportedHost();

  const helper = (options.createHelper ?? ((binaryPath, logger) => new NativeHelper({ binaryPath, logger })))(options.binaryPath, toHelperLogger(log));
  const listeners = new Set<(event: FnKeyEvent) => void>();
  let state: HelperStatus = 'stopped';
  let ready = false;

  helper.on('ready', ({ accessibility }) => {
    state = 'running';
    ready = true;
    if (!accessibility) log.warn('helper is running without Accessibility permission');
  });
  helper.on('unavailable', () => {
    state = 'unavailable';
    ready = false;
  });
  helper.on('exit', ({ restartInMs }) => {
    ready = false;
    state = restartInMs === null ? 'stopped' : 'unavailable';
  });
  helper.on('key', (event) => {
    const fnEvent: FnKeyEvent = { down: event.down, mods: event.mods, t: event.t };
    listeners.forEach((listener) => {
      try {
        listener(fnEvent);
      } catch (error) {
        log.error('fn key listener threw', { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  return {
    helper,
    start() {
      state = 'unavailable';
      helper.start();
    },
    stop() {
      helper.stop();
      state = 'stopped';
      ready = false;
    },
    status: () => (helper.isRunning && ready ? 'running' : state),
    isReady: () => helper.isRunning && ready,
    onFnKey(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function unsupportedHost(): HelperHost {
  return {
    helper: null,
    start: () => undefined,
    stop: () => undefined,
    status: () => 'unsupported',
    isReady: () => false,
    onFnKey: () => () => undefined,
  };
}
