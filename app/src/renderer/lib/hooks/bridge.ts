/**
 * Defensive access to the preload bridge for the overlay windows (island, Leafy, palette) and
 * anything else that wants it. `lib/ipc.ts` throws synchronously when no bridge exists (a plain
 * browser before the dev mock is installed); these wrappers turn that into a rejected promise or
 * a no-op subscription so a window never white-screens, and every failure is reported with context.
 */
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels';
import type { EventPayload, InvokeRequest, InvokeResult } from '@shared/ipc';
import { errorMessage, invoke, on } from '../ipc';

/** Renderer-side error sink. Renderers have no logger service, so this is the single place we print. */
export function reportError(scope: string, error: unknown): void {
  console.error(`[rivertide:${scope}]`, errorMessage(error), error);
}

/** `invoke` that always returns a promise (never throws synchronously). */
export async function safeInvoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResult<C>> {
  return invoke(channel, request);
}

/** Fire-and-forget invoke: failures are reported, never thrown. For pointer/position updates. */
export function fireAndForget<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): void {
  safeInvoke(channel, request).catch((error: unknown) => reportError(channel, error));
}

/** `on` that returns a no-op unsubscribe when the bridge is missing. */
export function safeOn<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void {
  try {
    return on(channel, listener);
  } catch (error) {
    reportError(`subscribe:${channel}`, error);
    return () => undefined;
  }
}
