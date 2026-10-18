/**
 * Fake AppContext for memory-agent tests: in-memory stores (validate → defaults on failure, like
 * the core json-store), a recording bus, and vi.fn fakes for llm / os / windows / agent / voice.
 * The real memory services are wired in so integration paths (search ↔ knowledge ↔ chat) work.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, vi } from 'vitest';
import { applySettingsPatch, DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../../../src/shared/settings';
import type { HistoryItem, SpeechStats } from '../../../src/shared/types';
import type { AppContext, BusEvents, CompletionRequest, CompletionResult, JsonStore, Logger } from '../../../src/main/services';
import { createHistoryRepository } from '../../../src/main/data/history';
import { createNotesService } from '../../../src/main/data/notes';
import { createKnowledgeService } from '../../../src/main/knowledge';
import { createDictionaryService } from '../../../src/main/knowledge/dictionary';
import { createDocumentsService, type DocumentsDeps } from '../../../src/main/knowledge/documents';
import { createSearchIndex } from '../../../src/main/knowledge/search-index';
import { createChatService } from '../../../src/main/chat';
import { createRemindersService } from '../../../src/main/scheduler';
import { createInsightsService } from '../../../src/main/analytics';
import { createPaletteService } from '../../../src/main/palette';

type Mutable = { -readonly [K in keyof AppContext]: AppContext[K] };

/** One scratch root per test file; document folders inside it are only created when used. */
const TEMP_ROOT = join(tmpdir(), `rivertide-memory-${randomUUID()}`);
afterAll(() => rmSync(TEMP_ROOT, { recursive: true, force: true }));

export function tempPath(name: string): string {
  return join(TEMP_ROOT, `${name}-${randomUUID()}`);
}

export interface Emitted { readonly event: keyof BusEvents; readonly payload: unknown }

export function createFakeBus() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emitted: Emitted[] = [];
  const bus = {
    emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]) {
      emitted.push({ event, payload });
      listeners.get(event)?.forEach((listener) => listener(payload));
    },
    on<K extends keyof BusEvents>(event: K, listener: (payload: BusEvents[K]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (payload: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (payload: unknown) => void);
    },
  };
  const of = <K extends keyof BusEvents>(event: K): BusEvents[K][] =>
    emitted.filter((entry) => entry.event === event).map((entry) => entry.payload as BusEvents[K]);
  return { bus, emitted, of };
}

export function createFakeLogger(): Logger & { readonly calls: Record<'debug' | 'info' | 'warn' | 'error', unknown[][]> } {
  const calls = { debug: [] as unknown[][], info: [] as unknown[][], warn: [] as unknown[][], error: [] as unknown[][] };
  const logger = {
    calls,
    debug: (...args: unknown[]) => void calls.debug.push(args),
    info: (...args: unknown[]) => void calls.info.push(args),
    warn: (...args: unknown[]) => void calls.warn.push(args),
    error: (...args: unknown[]) => void calls.error.push(args),
    child: () => logger,
  };
  return logger;
}

export function createMemoryStores(seed: Record<string, unknown> = {}) {
  const stores = new Map<string, JsonStore<unknown>>();
  const openStore = <T,>(name: string, options: { readonly defaults: T; readonly validate?: (raw: unknown) => T }): JsonStore<T> => {
    let value: T = options.defaults;
    if (name in seed) {
      try {
        value = options.validate ? options.validate(seed[name]) : (seed[name] as T);
      } catch {
        value = options.defaults;
      }
    }
    const store: JsonStore<T> = {
      read: () => value,
      write: (next) => { value = next; },
      update: (fn) => { value = fn(value); return value; },
      flush: async () => undefined,
    };
    stores.set(name, store as JsonStore<unknown>);
    return store;
  };
  return { openStore, stores };
}

const result = (text: string): CompletionResult => ({ text, providerId: 'fake', model: 'fake-model', latencyMs: 1 });

export function createFakeLlm() {
  return {
    isConfigured: vi.fn((_role: string) => true),
    complete: vi.fn(async (_role: string, _request: CompletionRequest) => result('{}')),
    stream: vi.fn(async (_role: string, _request: CompletionRequest, onDelta: (delta: string) => void) => {
      onDelta('Hello');
      return result('Hello');
    }),
    test: vi.fn(),
    reply: result,
  };
}

export function createFakeOs() {
  return {
    start: vi.fn(), stop: vi.fn(), frontmostApp: vi.fn(async () => null),
    paste: vi.fn(async () => true), typeText: vi.fn(async () => true), copy: vi.fn(),
    apps: {
      list: vi.fn(() => []), find: vi.fn(() => null),
      search: vi.fn((_query: string, _limit: number) => [] as { name: string; path: string; bundleId: string | null }[]),
      iconDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'), open: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined),
    },
    files: {
      search: vi.fn(async () => [] as { path: string; name: string; kind: string; modifiedAt: string | null }[]),
      open: vi.fn(async () => undefined), reveal: vi.fn(),
    },
    openUrl: vi.fn(async () => undefined), webSearch: vi.fn(async () => undefined),
    helperStatus: vi.fn(() => 'running' as const), onFnKey: vi.fn(() => () => undefined),
  };
}

export function createFakeWindows() {
  const panel = () => ({ show: vi.fn(), hide: vi.fn(), isVisible: vi.fn(() => false), setInteractive: vi.fn() });
  return {
    start: vi.fn(async () => undefined),
    dashboard: { show: vi.fn(), hide: vi.fn(), isVisible: vi.fn(() => true) },
    palette: { show: vi.fn(), hide: vi.fn(), isVisible: vi.fn(() => true), resize: vi.fn() },
    island: panel(),
    leafy: { ...panel(), moveTo: vi.fn(), persistPosition: vi.fn(), position: vi.fn(() => ({ x: 0, y: 0, corner: 'right' as const })), popupMenu: vi.fn(), applySize: vi.fn() },
    engine: { send: vi.fn(), isReady: vi.fn(() => true), markReady: vi.fn() },
    broadcast: vi.fn(),
    kindOf: vi.fn(() => 'dashboard' as const),
  };
}

export interface FakeOptions {
  readonly seed?: Record<string, unknown>;
  readonly settings?: SettingsPatch;
  readonly documentsDeps?: Partial<DocumentsDeps>;
  readonly notify?: (title: string, body: string) => void;
}

export function createFakeContext(options: FakeOptions = {}) {
  const { bus, emitted, of } = createFakeBus();
  const logger = createFakeLogger();
  const { openStore, stores } = createMemoryStores(options.seed);
  let settings: Settings = applySettingsPatch(DEFAULT_SETTINGS, options.settings ?? {});
  const settingsService = {
    get: () => settings,
    update: vi.fn((patch: SettingsPatch) => {
      settings = applySettingsPatch(settings, patch);
      return settings;
    }),
  };
  const llm = createFakeLlm();
  const os = createFakeOs();
  const windows = createFakeWindows();
  const agent = { ask: vi.fn(() => ({ runId: 'run-1' })), run: vi.fn(), confirm: vi.fn(), cancel: vi.fn() };
  const voice = { start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), snapshot: vi.fn(), handleFnKey: vi.fn(), onCapture: vi.fn(), onClap: vi.fn(), onWake: vi.fn(), onEngineError: vi.fn() };
  const documentsDir = join(tempPath('ctx'), 'documents');
  const ctx = {
    isDev: true, platform: 'darwin', version: 'test',
    paths: { userData: '/tmp', data: '/tmp', documents: documentsDir, media: '/tmp', logs: '/tmp', exports: '/tmp', resources: '/tmp' },
    logger, bus, settings: settingsService, openStore,
    llm, os, windows, agent, voice,
  } as unknown as Mutable;
  const notify = vi.fn(options.notify ?? (() => undefined));
  ctx.history = createHistoryRepository(ctx);
  ctx.notes = createNotesService(ctx);
  ctx.knowledge = createKnowledgeService(ctx);
  ctx.dictionary = createDictionaryService(ctx);
  ctx.documents = createDocumentsService(ctx, { ...fakeDocumentsDeps(), ...options.documentsDeps });
  ctx.search = createSearchIndex(ctx);
  ctx.chat = createChatService(ctx);
  ctx.reminders = createRemindersService(ctx, { notify });
  ctx.insights = createInsightsService(ctx);
  ctx.palette = createPaletteService(ctx);
  return { ctx: ctx as AppContext, bus, emitted, of, logger, stores, llm, os, windows, agent, voice, notify, settingsService, documentsDir };
}

export function fakeDocumentsDeps(): DocumentsDeps {
  return {
    platform: 'darwin',
    stat: vi.fn(async () => ({ size: 100, isFile: () => true })),
    readFile: vi.fn(async () => new TextEncoder().encode('hello')),
    execFile: vi.fn(async () => ({ stdout: '' })),
    pdfToText: vi.fn(async () => ''),
    pickFiles: vi.fn(async () => []),
  };
}

let counter = 0;

export function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  counter += 1;
  return {
    id: `h${counter.toString(36).padStart(6, '0')}`,
    createdAt: '2026-10-15T12:00:00.000Z',
    mode: 'dictate',
    source: 'fn',
    status: 'ok',
    raw: 'I have a follow up appointment with doctor Patel next Tuesday',
    output: 'I have a follow-up appointment with Dr. Patel next Tuesday.',
    words: 11,
    durationMs: 4000,
    app: { name: 'Notes', bundleId: 'com.apple.Notes' },
    pasted: true,
    error: null,
    timings: { sttMs: 400, llmMs: 600, totalMs: 1200 },
    providers: { stt: 'groq', llm: 'anthropic' },
    actions: [],
    audioPath: null,
    ...overrides,
  };
}

export function makeStats(overrides: Partial<SpeechStats> = {}): SpeechStats {
  return {
    durationMs: 10_000, speechMs: 8000, segments: 3, pauseCount: 2, longPauseCount: 0,
    meanPauseMs: 500, maxPauseMs: 700, speechLevelDb: -25, ...overrides,
  };
}
