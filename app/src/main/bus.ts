/**
 * Typed in-process event bus (`ctx.bus`). A listener that throws (or rejects) is reported through
 * `onListenerError` and never stops the other listeners or the emitter.
 */
import type { BusEvents, EventBus } from './services';

type AnyListener = (payload: never) => unknown;

export type ListenerErrorHandler = (event: keyof BusEvents, error: unknown) => void;

export function createBus(onListenerError: ListenerErrorHandler): EventBus {
  const listeners = new Map<keyof BusEvents, Set<AnyListener>>();

  const report = (event: keyof BusEvents, error: unknown): void => {
    try {
      onListenerError(event, error);
    } catch {
      // The error reporter itself failed; nothing safer to do than continue.
    }
  };

  return {
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const listener of [...set]) {
        try {
          const result = (listener as (p: typeof payload) => unknown)(payload);
          if (result instanceof Promise) result.catch((error: unknown) => report(event, error));
        } catch (error) {
          report(event, error);
        }
      }
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set<AnyListener>();
      listeners.set(event, set);
      const entry = listener as AnyListener;
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
  };
}
