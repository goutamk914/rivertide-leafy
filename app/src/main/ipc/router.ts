/**
 * IPC routing core: one `ipcMain.handle` per invoke channel, with
 *  1. sender check — the call must come from the top frame of one of our windows, on our origin,
 *     and that window kind must be allowed for the channel;
 *  2. zod validation of the request (`invokeSchemas`);
 *  3. readable errors back to the renderer, full detail to the log.
 * Plus the throttled `engine:level` stream → bus `audio:level`.
 */
import type { z } from 'zod';
import { invokeSchemas, sendSchemas } from '../../shared/ipc';
import { INVOKE_CHANNELS, type InvokeChannel } from '../../shared/ipc-channels';
import { isSameOrigin } from '../security';
import type { AppContext, WindowKind } from '../services';
import { RENDERER_WINDOWS } from '../windows/routing';
import { describeZodError, NOT_ALLOWED_MESSAGE, toUserError } from './errors';
import type { Handle, Handler, ParsedRequest, RegisterHandlers } from './types';

/** ~30 level updates per second is plenty for a waveform. */
export const LEVEL_INTERVAL_MS = 33;

/** The parts of an Electron IPC event we rely on (lets tests pass plain objects). */
export interface SenderEvent {
  readonly sender: { readonly id: number };
  readonly senderFrame?: { readonly parent: unknown; readonly url: string } | null;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: SenderEvent, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: SenderEvent, ...args: unknown[]) => void): unknown;
}

export interface IpcRouterOptions {
  readonly ipcMain: IpcMainLike;
  /** Origin our pages load from (app://rivertide, or the dev server). */
  readonly allowedOrigin: string;
  readonly now?: () => number;
}

export interface IpcRouter {
  readonly handle: Handle;
  /** Calls each module; one failing module is logged and does not stop the rest. */
  registerModules(modules: readonly (readonly [string, RegisterHandlers])[]): void;
  listenForLevels(): void;
  /** Validated "Hey Leafy" frames from the engine window (nothing else may send them). */
  listenForWakeAudio(onFrame: (samples: Int16Array, fresh: boolean) => void): void;
  missingChannels(): readonly InvokeChannel[];
}

export function defaultAllow(channel: InvokeChannel): readonly WindowKind[] {
  if (channel.startsWith('engine:')) return ['engine'];
  if (channel.startsWith('leafy:')) return ['leafy'];
  if (channel === 'island:pointer') return ['island'];
  return RENDERER_WINDOWS;
}

export function createIpcRouter(ctx: AppContext, options: IpcRouterOptions): IpcRouter {
  const log = ctx.logger.child('ipc');
  const now = options.now ?? Date.now;
  const registered = new Set<InvokeChannel>();

  /** Our window, top frame, our origin — or null. */
  const senderKind = (event: SenderEvent): WindowKind | null => {
    const kind = ctx.windows.kindOf(event.sender.id);
    const frame = event.senderFrame;
    if (!kind || !frame || frame.parent !== null) return null;
    return isSameOrigin(frame.url, options.allowedOrigin) ? kind : null;
  };

  const invoke = async <C extends InvokeChannel>(
    channel: C, handler: Handler<C>, allow: readonly WindowKind[], event: SenderEvent, raw: unknown,
  ): Promise<unknown> => {
    const kind = senderKind(event);
    if (!kind || !allow.includes(kind)) {
      log.warn('rejected IPC call from a sender that is not allowed', { channel, kind });
      throw new Error(NOT_ALLOWED_MESSAGE);
    }
    const schema: z.ZodType = invokeSchemas[channel];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 3).map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
      log.warn('invalid IPC request', { channel, issues });
      throw new Error(describeZodError(parsed.error));
    }
    try {
      return await handler(parsed.data as ParsedRequest<C>, { kind, webContentsId: event.sender.id });
    } catch (error) {
      log.error('IPC handler failed', { channel, error });
      throw toUserError(error);
    }
  };

  const handle: Handle = (channel, handler, handleOptions) => {
    if (registered.has(channel)) {
      log.error('a second handler for this channel was ignored', { channel });
      return;
    }
    if (!(channel in invokeSchemas)) {
      log.error('handler for a channel that is not in the contract was ignored', { channel });
      return;
    }
    registered.add(channel);
    const allow = handleOptions?.allow ?? defaultAllow(channel);
    options.ipcMain.handle(channel, (event, raw) => invoke(channel, handler, allow, event, raw));
  };

  const listenForLevels = (): void => {
    let lastEmit = Number.NEGATIVE_INFINITY;
    options.ipcMain.on('engine:level', (event, raw) => {
      if (senderKind(event) !== 'engine') return;
      const at = now();
      if (at - lastEmit < LEVEL_INTERVAL_MS) return;
      const parsed = sendSchemas['engine:level'].safeParse(raw);
      if (!parsed.success) return; // malformed meter frames are dropped silently (high rate)
      lastEmit = at;
      ctx.bus.emit('audio:level', parsed.data);
    });
  };

  const listenForWakeAudio = (onFrame: (samples: Int16Array, fresh: boolean) => void): void => {
    options.ipcMain.on('engine:wake-audio', (event, raw) => {
      if (senderKind(event) !== 'engine') return;
      const parsed = sendSchemas['engine:wake-audio'].safeParse(raw);
      if (!parsed.success) return; // malformed frames are dropped silently (12.5 per second)
      onFrame(parsed.data.samples, parsed.data.fresh);
    });
  };

  return {
    handle,
    listenForWakeAudio,
    registerModules(modules) {
      for (const [name, register] of modules) {
        try {
          register(ctx, handle);
        } catch (error) {
          log.error('handler module failed to register', { module: name, error });
        }
      }
    },
    listenForLevels,
    missingChannels: () => INVOKE_CHANNELS.filter((channel) => !registered.has(channel)),
  };
}
