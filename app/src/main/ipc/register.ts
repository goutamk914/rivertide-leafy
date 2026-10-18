/**
 * Registers every IPC handler module. Core modules live next to this file; the voice/agent and
 * memory modules are owned by their agents and follow `register<Namespace>Handlers(ctx, handle)`.
 * After registration, any contract channel without a handler is logged as an error.
 */
import { ipcMain } from 'electron';
import type { AppContext } from '../services';
import { registerAgentHandlers } from './handlers/agent';
import { registerAppHandlers } from './handlers/app';
import { registerChatHandlers } from './handlers/chat';
import { registerDataHandlers, type DataHandlerDeps } from './handlers/data';
import { registerDictionaryHandlers } from './handlers/dictionary';
import { registerDocumentsHandlers } from './handlers/documents';
import { registerEngineHandlers } from './handlers/engine';
import { registerHistoryHandlers } from './handlers/history';
import { registerHotkeysHandlers } from './handlers/hotkeys';
import { registerInsightsHandlers } from './handlers/insights';
import { registerIslandHandlers } from './handlers/island';
import { registerKnowledgeHandlers } from './handlers/knowledge';
import { registerLeafyHandlers } from './handlers/leafy';
import { registerNotesHandlers } from './handlers/notes';
import { registerPaletteHandlers } from './handlers/palette';
import { registerPermissionsHandlers } from './handlers/permissions';
import { registerProvidersHandlers } from './handlers/providers';
import { registerRemindersHandlers } from './handlers/reminders';
import { registerSecretsHandlers } from './handlers/secrets';
import { registerSettingsHandlers } from './handlers/settings';
import { registerSystemHandlers } from './handlers/system';
import { registerVoiceHandlers } from './handlers/voice';
import { registerWindowHandlers } from './handlers/window';
import { createIpcRouter, type IpcMainLike } from './router';
import type { RegisterHandlers } from './types';

export interface RegisterIpcOptions extends DataHandlerDeps {
  /** Origin our pages load from; IPC from any other origin is rejected. */
  readonly allowedOrigin: string;
  readonly ipcMain?: IpcMainLike;
  /** Receives "Hey Leafy" audio frames from the engine (the wake word service). */
  readonly onWakeAudio?: (samples: Int16Array, fresh: boolean) => void;
}

export function handlerModules(deps: DataHandlerDeps): readonly (readonly [string, RegisterHandlers])[] {
  return [
    ['app', registerAppHandlers],
    ['settings', registerSettingsHandlers],
    ['secrets', registerSecretsHandlers],
    ['permissions', registerPermissionsHandlers],
    ['window', registerWindowHandlers],
    ['data', (ctx, handle) => registerDataHandlers(ctx, handle, deps)],
    ['system', registerSystemHandlers],
    ['leafy', registerLeafyHandlers],
    ['island', registerIslandHandlers],
    ['engine', registerEngineHandlers],
    // voice / agent agent
    ['voice', registerVoiceHandlers],
    ['agent', registerAgentHandlers],
    ['providers', registerProvidersHandlers],
    ['hotkeys', registerHotkeysHandlers],
    // memory / insights agent
    ['history', registerHistoryHandlers],
    ['knowledge', registerKnowledgeHandlers],
    ['dictionary', registerDictionaryHandlers],
    ['documents', registerDocumentsHandlers],
    ['chat', registerChatHandlers],
    ['notes', registerNotesHandlers],
    ['reminders', registerRemindersHandlers],
    ['insights', registerInsightsHandlers],
    ['palette', registerPaletteHandlers],
  ];
}

export function registerIpc(ctx: AppContext, options: RegisterIpcOptions): void {
  const router = createIpcRouter(ctx, { ipcMain: options.ipcMain ?? ipcMain, allowedOrigin: options.allowedOrigin });
  router.registerModules(handlerModules(options));
  router.listenForLevels();
  if (options.onWakeAudio) router.listenForWakeAudio(options.onWakeAudio);
  const missing = router.missingChannels();
  if (missing.length > 0) ctx.logger.child('ipc').error('contract channels without a handler', { missing });
}
