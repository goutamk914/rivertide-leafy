/**
 * Composition logic used by bootstrap.ts, kept free of concrete feature imports so it can be
 * tested with fakes: assemble the AppContext, start services in order, and wire background jobs.
 */
import type { Settings } from '../shared/settings';
import type { HistoryItem } from '../shared/types';
import { guarded, runInBackground } from './guard';
import type {
  AgentService, AppContext, ChatService, DictionaryService, DocumentsService, EventBus, HistoryRepository,
  HotkeysService, InsightsService, KnowledgeService, LlmRouter, Logger, NotesService, OsServices, PaletteService, Paths,
  PermissionsService, RemindersService, SearchIndex, SecretsService, ServiceFactory, SettingsService, SttService,
  VoiceService, WindowsService,
} from './services';

export interface CoreParts {
  readonly isDev: boolean;
  readonly platform: AppContext['platform'];
  readonly version: string;
  readonly paths: Paths;
  readonly logger: Logger;
  readonly bus: EventBus;
  readonly openStore: AppContext['openStore'];
}

export interface ServiceFactories {
  readonly createSettingsService: ServiceFactory<SettingsService>;
  readonly createSecretsService: ServiceFactory<SecretsService>;
  readonly createWindowsService: ServiceFactory<WindowsService>;
  readonly createPermissionsService: ServiceFactory<PermissionsService>;
  readonly createLlmRouter: ServiceFactory<LlmRouter>;
  readonly createSttService: ServiceFactory<SttService>;
  readonly createOsServices: ServiceFactory<OsServices>;
  readonly createVoiceService: ServiceFactory<VoiceService>;
  readonly createAgentService: ServiceFactory<AgentService>;
  readonly createHotkeysService: ServiceFactory<HotkeysService>;
  readonly createHistoryRepository: ServiceFactory<HistoryRepository>;
  readonly createKnowledgeService: ServiceFactory<KnowledgeService>;
  readonly createDictionaryService: ServiceFactory<DictionaryService>;
  readonly createDocumentsService: ServiceFactory<DocumentsService>;
  readonly createSearchIndex: ServiceFactory<SearchIndex>;
  readonly createChatService: ServiceFactory<ChatService>;
  readonly createNotesService: ServiceFactory<NotesService>;
  readonly createRemindersService: ServiceFactory<RemindersService>;
  readonly createInsightsService: ServiceFactory<InsightsService>;
  readonly createPaletteService: ServiceFactory<PaletteService>;
}

type Assembling = { -readonly [K in keyof AppContext]: AppContext[K] };

/**
 * Builds the context in one place: core parts first, then core services, then feature services.
 * Factories receive the (still assembling) context and may only store it; it is frozen at the end.
 */
export function assembleContext(core: CoreParts, factories: ServiceFactories): AppContext {
  const ctx = { ...core } as Assembling;
  ctx.settings = factories.createSettingsService(ctx);
  ctx.secrets = factories.createSecretsService(ctx);
  ctx.windows = factories.createWindowsService(ctx);
  ctx.permissions = factories.createPermissionsService(ctx);
  ctx.llm = factories.createLlmRouter(ctx);
  ctx.stt = factories.createSttService(ctx);
  ctx.os = factories.createOsServices(ctx);
  ctx.voice = factories.createVoiceService(ctx);
  ctx.agent = factories.createAgentService(ctx);
  ctx.hotkeys = factories.createHotkeysService(ctx);
  ctx.history = factories.createHistoryRepository(ctx);
  ctx.knowledge = factories.createKnowledgeService(ctx);
  ctx.dictionary = factories.createDictionaryService(ctx);
  ctx.documents = factories.createDocumentsService(ctx);
  ctx.search = factories.createSearchIndex(ctx);
  ctx.chat = factories.createChatService(ctx);
  ctx.notes = factories.createNotesService(ctx);
  ctx.reminders = factories.createRemindersService(ctx);
  ctx.insights = factories.createInsightsService(ctx);
  ctx.palette = factories.createPaletteService(ctx);
  return Object.freeze(ctx);
}

export const START_ORDER = ['windows', 'os', 'hotkeys', 'reminders', 'insights'] as const;
export type StartStep = (typeof START_ORDER)[number];

const STARTERS: Readonly<Record<StartStep, (ctx: AppContext) => unknown>> = {
  windows: (ctx) => ctx.windows.start(),
  os: (ctx) => ctx.os.start(),
  hotkeys: (ctx) => ctx.hotkeys.start(),
  reminders: (ctx) => ctx.reminders.start(),
  insights: (ctx) => ctx.insights.start(),
};

/** Starts services in order. A failing step is logged and the rest still start; returns the failures. */
export async function startServices(ctx: AppContext): Promise<readonly StartStep[]> {
  const log = ctx.logger.child('startup');
  const failed: StartStep[] = [];
  for (const step of START_ORDER) {
    try {
      await STARTERS[step](ctx);
    } catch (error) {
      log.error('service failed to start', { step, error });
      failed.push(step);
    }
  }
  return failed;
}

export interface BackgroundHooks {
  /** Applies "open at login" to the OS (no-op in development). */
  readonly setLoginItem: (openAtLogin: boolean) => void;
}

function onVoiceCompleted(ctx: AppContext, log: Logger, item: HistoryItem): void {
  const settings = ctx.settings.get();
  // History off means "don't keep what I say": nothing derived from the words is stored either.
  if (!settings.privacy.historyEnabled) return;
  const hasWords = item.status === 'ok' && item.raw.trim().length > 0;
  if (hasWords && settings.knowledge.autoExtract) {
    runInBackground(log, 'knowledge.extractFrom', () => ctx.knowledge.extractFrom(item));
  }
  // Only dictation pairs the user's words with a polished version of the same words.
  if (hasWords && item.mode === 'dictate' && settings.knowledge.learnDictionary) {
    runInBackground(log, 'dictionary.learnFrom', () => ctx.dictionary.learnFrom(item.raw, item.output));
  }
  runInBackground(log, 'search.invalidate', () => ctx.search.invalidate('history'));
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Applies the side effects of a settings change, comparing against the previous settings. */
export function applySettingsChange(ctx: AppContext, log: Logger, hooks: BackgroundHooks, previous: Settings, next: Settings): void {
  if (!sameJson(previous.hotkeys, next.hotkeys) || previous.voice.inputMode !== next.voice.inputMode) {
    guarded(log, 'hotkeys.reload', () => ctx.hotkeys.reload())();
  }
  if (previous.leafy.visible !== next.leafy.visible) {
    guarded(log, 'leafy visibility', () => (next.leafy.visible ? ctx.windows.leafy.show() : ctx.windows.leafy.hide()))();
  }
  if (previous.leafy.size !== next.leafy.size) {
    guarded(log, 'leafy size', () => ctx.windows.leafy.applySize(next.leafy.size))();
  }
  if (previous.system.launchAtLogin !== next.system.launchAtLogin) {
    guarded(log, 'login item', () => hooks.setLoginItem(next.system.launchAtLogin))();
  }
}

/** Background jobs that react to bus events. Returns a function that unwires them. */
export function wireBackgroundJobs(ctx: AppContext, hooks: BackgroundHooks): () => void {
  const log = ctx.logger.child('jobs');
  let previous = ctx.settings.get();
  const offCompleted = ctx.bus.on('voice:completed', ({ item }) => onVoiceCompleted(ctx, log, item));
  const offSettings = ctx.bus.on('settings:changed', (next) => {
    const before = previous;
    previous = next;
    applySettingsChange(ctx, log, hooks, before, next);
  });
  return () => {
    offCompleted();
    offSettings();
  };
}
