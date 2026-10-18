/**
 * Handler-module contract. Each namespace lives in `ipc/handlers/<namespace>.ts` and exports
 * `register<Namespace>Handlers(ctx: AppContext, handle: Handle): void`. `register.ts` (core)
 * validates the request with zod and checks the sender before calling the handler, so handlers
 * receive already-parsed input and never see raw IPC events.
 */
import type { z } from 'zod';
import type { InvokeChannel } from '../../shared/ipc-channels';
import type { InvokeResult, invokeSchemas } from '../../shared/ipc';
import type { AppContext, WindowKind } from '../services';

export interface SenderInfo {
  readonly kind: WindowKind;
  readonly webContentsId: number;
}

export type ParsedRequest<C extends InvokeChannel> = z.output<(typeof invokeSchemas)[C]>;

export type Handler<C extends InvokeChannel> = (
  request: ParsedRequest<C>,
  sender: SenderInfo,
) => Promise<InvokeResult<C>> | InvokeResult<C>;

export interface HandleOptions {
  /** Restrict which windows may call this channel. Default: every Rivertide window except engine. */
  readonly allow?: readonly WindowKind[];
}

export type Handle = <C extends InvokeChannel>(channel: C, handler: Handler<C>, options?: HandleOptions) => void;

export type RegisterHandlers = (ctx: AppContext, handle: Handle) => void;
