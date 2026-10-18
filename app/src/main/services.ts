/**
 * Main-process service contracts — the seams between feature modules.
 *
 * Composition rules (see bootstrap.ts):
 *  - Every feature exposes one factory `createX(ctx: AppContext): X` at the path listed below.
 *  - Factories may only STORE `ctx`; they must not call other services while constructing,
 *    because the context is still being assembled. Do async setup in `start()` methods.
 *  - Services talk to each other only through these interfaces, never through each other's files.
 *  - Renderer-facing pushes go through `ctx.bus.emit(...)`; the windows service forwards them.
 */
import type {
  AgentActionSummary, AgentEvent, AudioLevel, ChatEvent, ChatSession, ChatSummary, DataDomain, DictionaryEntry,
  DocumentMeta, DynamicsSummary, Fact, FactCategory, FactSource, FogReading, FrontmostApp, HistoryItem,
  HotkeyStatus, Id, KnowledgeGraph, LeafyCue, Note, PermissionStatus, Reminder, SearchResult, SpeechStats,
  Toast, UsageSummary, VoiceMode, VoiceSnapshot, VoiceSource,
} from '../shared/types';
import type { EngineCommand, EventPayload, ProviderTestResult, SecretStatus, CaptureEndReason } from '../shared/ipc';
import type { EventChannel } from '../shared/ipc-channels';
import type { LlmRole, SecretId, Settings, SettingsPatch } from '../shared/settings';
import type { z } from 'zod';

// ── Core ─────────────────────────────────────────────────────────────────────
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface Paths {
  readonly userData: string;
  /** JSON stores live here. */
  readonly data: string;
  readonly documents: string;
  readonly media: string;
  readonly logs: string;
  readonly exports: string;
  /** Packaged resources (native helper, icons). */
  readonly resources: string;
}

/** In-process events. Renderer-facing ones are forwarded by the windows service. */
export interface BusEvents {
  'settings:changed': Settings;
  'data:changed': { readonly domain: DataDomain };
  'voice:snapshot': VoiceSnapshot;
  'audio:level': AudioLevel;
  'agent:event': AgentEvent;
  'chat:event': ChatEvent;
  'leafy:cue': LeafyCue;
  'toast': Toast;
  /** A voice session finished and was saved; background jobs (knowledge, dynamics, dictionary) listen here. */
  'voice:completed': { readonly item: HistoryItem; readonly stats: SpeechStats | null };
  'reminder:fired': Reminder;
  'clap': { readonly at: number };
}

export interface EventBus {
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void;
  on<K extends keyof BusEvents>(event: K, listener: (payload: BusEvents[K]) => void): () => void;
}

export interface SettingsService {
  get(): Settings;
  /** Validates, persists, emits `settings:changed`. Throws on invalid patches. */
  update(patch: SettingsPatch): Settings;
}

export interface SecretsService {
  get(id: SecretId): string | null;
  set(id: SecretId, value: string): SecretStatus;
  clear(id: SecretId): SecretStatus;
  status(): SecretStatus;
  /** False when OS encryption is unavailable (keys are then refused, never stored in plain text). */
  isEncryptionAvailable(): boolean;
}

export type WindowKind = 'dashboard' | 'island' | 'leafy' | 'palette' | 'engine';

export interface WindowsService {
  start(): Promise<void>;
  readonly dashboard: { show(route?: string): void; hide(): void; isVisible(): boolean };
  readonly palette: { show(mode: 'search' | 'voice', query?: string | null): void; hide(): void; isVisible(): boolean; resize(height: number): void };
  readonly island: { show(): void; hide(): void; setInteractive(interactive: boolean): void };
  readonly leafy: {
    show(): void; hide(): void; isVisible(): boolean; setInteractive(interactive: boolean): void;
    moveTo(x: number, y: number): void; persistPosition(): void; position(): { x: number; y: number; corner: 'left' | 'right' };
    popupMenu(): void; applySize(size: Settings['leafy']['size']): void;
  };
  readonly engine: { send(command: EngineCommand): void; isReady(): boolean; markReady(): void };
  broadcast<C extends EventChannel>(channel: C, payload: EventPayload<C>): void;
  /** Identifies which of our windows sent an IPC message (null = not ours → reject). */
  kindOf(webContentsId: number): WindowKind | null;
}

export type PermissionKind = 'microphone' | 'accessibility' | 'input-monitoring' | 'automation' | 'screen';

export interface PermissionsService {
  status(): Promise<PermissionStatus>;
  request(kind: PermissionKind): Promise<PermissionStatus>;
  openSettings(kind: PermissionKind): Promise<void>;
}

/** Atomic, debounced JSON file persistence (see store/json-store.ts). */
export interface JsonStore<T> {
  read(): T;
  /** Replaces the whole value (immutably) and schedules a debounced atomic write. */
  write(next: T): void;
  update(fn: (current: T) => T): T;
  flush(): Promise<void>;
}

// ── AI (owner: voice/agent agent) — main/ai/llm/router.ts, main/ai/stt/index.ts ──
export interface CompletionMessage { readonly role: 'user' | 'assistant'; readonly content: string }
export interface CompletionRequest {
  readonly system: string;
  readonly messages: readonly CompletionMessage[];
  readonly maxTokens?: number;
  /** Ask the provider for a single JSON object (structured output when supported). */
  readonly json?: boolean;
  readonly signal?: AbortSignal;
}
export interface CompletionResult { readonly text: string; readonly providerId: string; readonly model: string; readonly latencyMs: number }

export interface LlmRouter {
  isConfigured(role: LlmRole): boolean;
  complete(role: LlmRole, request: CompletionRequest): Promise<CompletionResult>;
  stream(role: LlmRole, request: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult>;
  test(providerId: string): Promise<ProviderTestResult>;
}

export interface TranscriptionResult { readonly text: string; readonly providerId: string; readonly latencyMs: number; readonly noSpeech: boolean }
export interface SttService {
  isConfigured(): boolean;
  transcribe(wav: Uint8Array, options: { readonly prompt?: string; readonly signal?: AbortSignal }): Promise<TranscriptionResult>;
  test(providerId?: string): Promise<ProviderTestResult>;
}

// ── OS (owner: voice/agent agent) — main/os/index.ts ─────────────────────────
export interface AppEntry { readonly name: string; readonly path: string; readonly bundleId: string | null }
export interface FileHit { readonly path: string; readonly name: string; readonly kind: string; readonly modifiedAt: string | null }
export interface FnKeyEvent { readonly down: boolean; readonly mods: { readonly ctrl: boolean; readonly shift: boolean; readonly alt: boolean; readonly cmd: boolean }; readonly t: number }

export interface OsServices {
  start(): Promise<void>;
  stop(): void;
  frontmostApp(): Promise<FrontmostApp | null>;
  /** Pastes at the cursor of `target` (or the frontmost app); restores the clipboard. False = left on clipboard. */
  paste(text: string, target: FrontmostApp | null): Promise<boolean>;
  typeText(text: string): Promise<boolean>;
  copy(text: string): void;
  readonly apps: {
    list(): readonly AppEntry[];
    find(query: string): AppEntry | null;
    search(query: string, limit: number): readonly AppEntry[];
    iconDataUrl(path: string): Promise<string | null>;
    open(entry: AppEntry): Promise<void>;
    refresh(): Promise<void>;
  };
  readonly files: {
    search(query: string, options: { readonly limit: number }): Promise<readonly FileHit[]>;
    open(path: string): Promise<void>;
    reveal(path: string): void;
  };
  openUrl(url: string): Promise<void>;
  webSearch(query: string): Promise<void>;
  /** Native helper status for permissions UI. */
  helperStatus(): 'running' | 'unavailable' | 'stopped' | 'unsupported';
  /** Subscribe to fn/modifier key transitions (macOS helper). */
  onFnKey(listener: (event: FnKeyEvent) => void): () => void;
}

// ── Voice & agent (owner: voice/agent agent) ─────────────────────────────────
export interface CapturePayload {
  readonly requestId: Id;
  readonly reason: z.infer<typeof CaptureEndReason>;
  readonly wav: Uint8Array | null;
  readonly stats: SpeechStats;
  readonly error?: string;
}

export interface VoiceService {
  snapshot(): VoiceSnapshot;
  start(mode: VoiceMode, source: VoiceSource): VoiceSnapshot;
  stop(): VoiceSnapshot;
  cancel(): VoiceSnapshot;
  /** fn key semantics (hold / double-press lock / ctrl → ask / shift → command). */
  handleFnKey(event: FnKeyEvent): void;
  onCapture(payload: CapturePayload): Promise<void>;
  onClap(at: number): void;
  /** "Hey Leafy" was heard and confirmed: summon Leafy and listen for a command (never acts by itself). */
  onWake(at: number): void;
  onEngineError(scope: string, message: string): void;
}

export interface AgentService {
  ask(text: string, source: 'palette' | 'leafy' | 'dashboard' | 'voice'): { runId: Id };
  /** Runs a full command and resolves with the final reply (used by voice). */
  run(text: string, source: 'voice' | 'palette' | 'leafy' | 'dashboard'): Promise<{ runId: Id; reply: string; ok: boolean; actions: readonly AgentActionSummary[] }>;
  confirm(runId: Id, callId: Id, approved: boolean): void;
  cancel(runId: Id): void;
}

export interface HotkeysService {
  start(): void;
  stop(): void;
  /** Re-registers after settings change; returns what actually registered. */
  reload(): readonly HotkeyStatus[];
  status(): readonly HotkeyStatus[];
}

// ── Memory & insights (owner: memory agent) ──────────────────────────────────
export interface HistoryQuery { readonly query?: string; readonly mode?: VoiceMode; readonly limit?: number; readonly before?: string }

export interface HistoryRepository {
  list(query: HistoryQuery): readonly HistoryItem[];
  get(id: Id): HistoryItem | null;
  add(item: HistoryItem): void;
  update(id: Id, patch: Partial<Omit<HistoryItem, 'id' | 'createdAt'>>): HistoryItem | null;
  delete(id: Id): void;
  clear(): void;
  recent(limit: number): readonly HistoryItem[];
}

export interface KnowledgeService {
  list(query?: { readonly query?: string; readonly category?: FactCategory }): readonly Fact[];
  upsert(input: { id?: Id; category: FactCategory; label: string; value: string; pinned?: boolean }, source?: FactSource): Fact;
  delete(id: Id): void;
  graph(): KnowledgeGraph;
  /** Facts most relevant to a query (BM25 + pinned), for prompts. */
  relevant(query: string, limit: number): readonly Fact[];
  /** Background LLM extraction from a finished dictation; never throws. */
  extractFrom(item: HistoryItem): Promise<readonly Fact[]>;
}

export interface DictionaryService {
  list(): readonly DictionaryEntry[];
  upsert(input: { id?: Id; term: string; replaces: readonly string[]; note?: string }, source?: 'manual' | 'learned'): DictionaryEntry;
  delete(id: Id): void;
  /** Terms for STT prompts and the polish prompt's hot-word table. */
  terms(limit: number): readonly string[];
  /** Deterministic replacement of known mis-hearings. */
  apply(text: string): string;
  learnFrom(raw: string, polished: string): Promise<void>;
}

export interface DocumentsService {
  list(): readonly DocumentMeta[];
  pick(): Promise<readonly DocumentMeta[]>;
  importText(name: string, text: string): DocumentMeta;
  importFile(path: string): Promise<DocumentMeta>;
  get(id: Id): { meta: DocumentMeta; text: string } | null;
  delete(id: Id): void;
}

export interface SearchHit { readonly kind: 'document' | 'fact' | 'history' | 'note'; readonly id: Id; readonly title: string; readonly snippet: string; readonly score: number }
export interface SearchIndex {
  search(query: string, options?: { readonly kinds?: readonly SearchHit['kind'][]; readonly limit?: number }): readonly SearchHit[];
  /** Mark dirty; the index rebuilds lazily on the next search. */
  invalidate(domain?: DataDomain): void;
}

export interface ChatService {
  list(): readonly ChatSummary[];
  get(id: Id): ChatSession | null;
  create(): ChatSession;
  rename(id: Id, title: string): ChatSummary;
  delete(id: Id): void;
  /** Streams `chat:event`s on the bus; resolves immediately with the message ids. */
  send(sessionId: Id, text: string): Promise<{ userMessageId: Id; assistantMessageId: Id }>;
}

export interface NotesService {
  list(query?: string): readonly Note[];
  upsert(input: { id?: Id; title: string; body: string; pinned?: boolean }, source?: Note['source']): Note;
  delete(id: Id): void;
}

export interface RemindersService {
  start(): void;
  stop(): void;
  list(): readonly Reminder[];
  create(input: { kind: 'reminder' | 'timer'; text: string; dueAt?: string; inMinutes?: number; repeat?: 'none' | 'daily' }): Reminder;
  cancel(id: Id): void;
}

export interface InsightsService {
  start(): void;
  usage(days: number): UsageSummary;
  dynamics(days: number): DynamicsSummary;
  currentFog(): FogReading | null;
}

export interface PaletteService {
  search(query: string, limit: number): Promise<readonly SearchResult[]>;
  execute(id: Id, alt: boolean): Promise<{ ok: boolean; message: string | null }>;
}

// ── The context ──────────────────────────────────────────────────────────────
export interface AppContext {
  readonly isDev: boolean;
  readonly platform: 'darwin' | 'win32' | 'linux';
  readonly version: string;
  readonly paths: Paths;
  readonly logger: Logger;
  readonly bus: EventBus;
  readonly settings: SettingsService;
  readonly secrets: SecretsService;
  readonly windows: WindowsService;
  readonly permissions: PermissionsService;
  readonly openStore: <T>(name: string, options: { readonly defaults: T; readonly validate?: (raw: unknown) => T }) => JsonStore<T>;

  readonly llm: LlmRouter;
  readonly stt: SttService;
  readonly os: OsServices;
  readonly voice: VoiceService;
  readonly agent: AgentService;
  readonly hotkeys: HotkeysService;

  readonly history: HistoryRepository;
  readonly knowledge: KnowledgeService;
  readonly dictionary: DictionaryService;
  readonly documents: DocumentsService;
  readonly search: SearchIndex;
  readonly chat: ChatService;
  readonly notes: NotesService;
  readonly reminders: RemindersService;
  readonly insights: InsightsService;
  readonly palette: PaletteService;
}

/**
 * Factory locations (fixed — bootstrap.ts imports exactly these):
 *   core agent    : createSettingsService  main/settings-service.ts · createSecretsService main/secrets.ts
 *                   createWindowsService    main/windows/index.ts   · createPermissionsService main/permissions.ts
 *   voice/agent   : createLlmRouter main/ai/llm/router.ts · createSttService main/ai/stt/index.ts
 *                   createOsServices main/os/index.ts · createVoiceService main/voice/index.ts
 *                   createAgentService main/agent/index.ts · createHotkeysService main/input/hotkeys.ts
 *   memory agent  : createHistoryRepository main/data/history.ts · createNotesService main/data/notes.ts
 *                   createKnowledgeService main/knowledge/index.ts · createDictionaryService main/knowledge/dictionary.ts
 *                   createDocumentsService main/knowledge/documents.ts · createSearchIndex main/knowledge/search-index.ts
 *                   createChatService main/chat/index.ts · createRemindersService main/scheduler/index.ts
 *                   createInsightsService main/analytics/index.ts · createPaletteService main/palette/index.ts
 * Each factory: `export function createX(ctx: AppContext): X`.
 */
export type ServiceFactory<T> = (ctx: AppContext) => T;

export type { AgentEvent, ChatEvent, LeafyCue, Toast, AudioLevel };
