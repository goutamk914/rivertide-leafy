/**
 * The hidden audio engine window (mic capture, VAD, clap detector, TTS, cues). Commands are queued
 * until the engine page reports `engine:ready`, and re-queued across reloads after a crash.
 */
import type { BrowserWindow } from 'electron';
import type { EngineCommand } from '../../shared/ipc';
import { createSecureWindow, type WindowEnv } from './common';

/** Oldest commands are dropped beyond this (a stuck engine must not grow memory forever). */
export const MAX_QUEUED_COMMANDS = 50;

export interface EngineController {
  send(command: EngineCommand): void;
  isReady(): boolean;
  markReady(): void;
  current(): BrowserWindow | null;
  destroy(): void;
}

/** Pure queue logic, separate from the window so it can be tested without Electron. */
export function createCommandQueue(deliver: (command: EngineCommand) => void, limit = MAX_QUEUED_COMMANDS) {
  let ready = false;
  let queue: readonly EngineCommand[] = [];
  return {
    send(command: EngineCommand): void {
      if (ready) {
        deliver(command);
        return;
      }
      queue = [...queue, command].slice(-limit);
    },
    markReady(): void {
      ready = true;
      const pending = queue;
      queue = [];
      pending.forEach(deliver);
    },
    reset(): void {
      ready = false;
    },
    isReady: (): boolean => ready,
    size: (): number => queue.length,
  };
}

export function createEngine(env: WindowEnv): EngineController {
  const log = env.logger.child('window:engine');
  const win = createSecureWindow(env, 'engine', {
    width: 1,
    height: 1,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
  }, {
    backgroundThrottling: false,
    // The engine never gets a user gesture; without this AudioContext.resume() never settles.
    autoplayPolicy: 'no-user-gesture-required',
  });
  const alive = (): boolean => !win.isDestroyed() && !win.webContents.isDestroyed();

  const queue = createCommandQueue((command) => {
    if (alive()) win.webContents.send('engine:command', command);
    else log.warn('engine window is gone; command dropped', { type: command.type });
  });

  // A reload (crash recovery or dev HMR) means the page must announce itself again.
  win.webContents.on('did-start-loading', () => queue.reset());

  return {
    send: (command) => queue.send(command),
    isReady: () => queue.isReady(),
    markReady() {
      queue.markReady();
      log.info('engine ready');
    },
    current: () => (alive() ? win : null),
    destroy() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
