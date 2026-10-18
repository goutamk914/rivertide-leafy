/**
 * Error guards for callbacks Electron or the bus invoke on our behalf (menu clicks, background
 * jobs): failures are logged with context instead of becoming uncaught exceptions.
 */
import type { Logger } from './services';

/** Wraps `action` so sync throws and async rejections are logged under `label`. */
export function guarded(logger: Logger, label: string, action: () => unknown): () => void {
  return () => {
    try {
      const result = action();
      if (result instanceof Promise) result.catch((error: unknown) => logger.error('action failed', { label, error }));
    } catch (error) {
      logger.error('action failed', { label, error });
    }
  };
}

/** Runs `job` on the next turn of the event loop so the caller is never blocked or broken by it. */
export function runInBackground(logger: Logger, label: string, job: () => unknown): void {
  setImmediate(guarded(logger, label, job));
}
