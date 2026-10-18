/** Shared types for the browser mock's handler modules. */
import type { z } from 'zod';
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels';
import type { EventPayload, InvokeResult, invokeSchemas } from '@shared/ipc';
import type { MockState } from './data';

/** The request a handler receives, after the mock validated it with the contract's zod schema. */
export type ParsedRequest<C extends InvokeChannel> = z.output<(typeof invokeSchemas)[C]>;

export type MockHandler<C extends InvokeChannel> = (request: ParsedRequest<C>) => InvokeResult<C> | Promise<InvokeResult<C>>;

/** One handler for every invoke channel in the contract. */
export type MockHandlers = { readonly [C in InvokeChannel]: MockHandler<C> };

export interface MockContext {
  readonly get: () => MockState;
  readonly set: (update: (state: MockState) => MockState) => void;
  readonly emit: <C extends EventChannel>(channel: C, payload: EventPayload<C>) => void;
  readonly now: () => Date;
  /** setTimeout that the bridge can cancel on reset. */
  readonly schedule: (fn: () => void, ms: number) => void;
  /** setInterval that the bridge can cancel on reset; returns its own cancel function. */
  readonly every: (fn: () => void, ms: number) => () => void;
}

export const OK = { ok: true } as const;

export function notFound(what: string): Error {
  return new Error(`That ${what} no longer exists. It may have been deleted.`);
}
