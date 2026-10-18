/**
 * Electron wiring for "Hey Leafy": forks dist-electron/wake-worker.cjs as a utility process and
 * tells it where onnxruntime lives in a packaged build. Everything testable is in service.ts.
 */
import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { AppContext } from '../services';
import { missingModelFiles, wakeModelDir } from './model-files';
import { createWakeWordService, type WakeChild, type WakeWordService } from './service';

export type { WakeWordService } from './service';

const WORKER_FILE = 'wake-worker.cjs';

export interface WakeRuntimeOptions {
  readonly isPackaged: boolean;
  /** `process.resourcesPath` (packaged builds copy onnxruntime-node under node_modules there). */
  readonly resourcesPath: string;
}

function forkWorker(options: WakeRuntimeOptions): WakeChild {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  if (options.isPackaged) env['RIVERTIDE_ORT_MODULE'] = join(options.resourcesPath, 'node_modules', 'onnxruntime-node');
  const child = utilityProcess.fork(join(__dirname, WORKER_FILE), [], { serviceName: 'Rivertide Wake Word', env });
  return {
    postMessage: (message) => child.postMessage(message),
    kill: () => { child.kill(); },
    onMessage: (listener) => { child.on('message', listener); },
    onExit: (listener) => { child.on('exit', listener); },
  };
}

export function createWakeWord(ctx: AppContext, options: WakeRuntimeOptions): WakeWordService {
  const modelDir = wakeModelDir(ctx.paths.resources, options.isPackaged);
  return createWakeWordService(ctx, {
    fork: () => forkWorker(options),
    modelDir,
    missingFiles: () => missingModelFiles(modelDir),
    // onnxruntime-node ships macOS binaries for Apple silicon only.
    isSupported: () => !(process.platform === 'darwin' && process.arch !== 'arm64'),
  });
}
