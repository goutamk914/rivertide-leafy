/**
 * Minimal fakes for AppContext services used by agent/voice tests. Only what those modules touch
 * is implemented; everything is recorded for assertions.
 */
import { vi } from 'vitest';
import type { AgentService, AppContext, AppEntry, BusEvents, EventBus, Logger, OsServices, VoiceService } from '../../../src/main/services';
import type { EngineCommand } from '../../../src/shared/ipc';
import { applySettingsPatch, DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../../../src/shared/settings';
import type { FrontmostApp, HistoryItem, Note, Reminder } from '../../../src/shared/types';

export const silentLogger = (): Logger => {
  const logger: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, child: () => logger };
  return logger;
};

export interface RecordingBus extends EventBus {
  readonly emitted: { readonly event: keyof BusEvents; readonly payload: unknown }[];
  of<K extends keyof BusEvents>(event: K): BusEvents[K][];
}

export function createBus(): RecordingBus {
  const listeners = new Map<keyof BusEvents, Set<(payload: never) => void>>();
  const emitted: { event: keyof BusEvents; payload: unknown }[] = [];
  return {
    emitted,
    emit(event, payload) {
      emitted.push({ event, payload });
      listeners.get(event)?.forEach((listener) => (listener as (value: typeof payload) => void)(payload));
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (payload: never) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (payload: never) => void);
    },
    of: (event) => emitted.filter((entry) => entry.event === event).map((entry) => entry.payload as BusEvents[typeof event]),
  };
}

export const APPS: readonly AppEntry[] = [
  { name: 'Calendar', path: '/System/Applications/Calendar.app', bundleId: 'com.apple.iCal' },
  { name: 'Spotify', path: '/Applications/Spotify.app', bundleId: 'com.spotify.client' },
  { name: 'Notes', path: '/System/Applications/Notes.app', bundleId: 'com.apple.Notes' },
];

export function fakeOs(overrides: Partial<OsServices> = {}): OsServices & { pasted: string[]; copied: string[]; opened: string[] } {
  const pasted: string[] = [];
  const copied: string[] = [];
  const opened: string[] = [];
  const find = (query: string) => APPS.find((app) => app.name.toLowerCase() === query.toLowerCase().trim()) ?? null;
  return {
    pasted, copied, opened,
    start: async () => undefined,
    stop: () => undefined,
    frontmostApp: async (): Promise<FrontmostApp | null> => ({ name: 'Mail', bundleId: 'com.apple.mail', pid: 42 }),
    paste: async (text) => { pasted.push(text); return true; },
    typeText: async () => true,
    copy: (text) => { copied.push(text); },
    apps: {
      list: () => APPS, find, search: (query, limit) => APPS.filter((app) => app.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit),
      iconDataUrl: async () => null, open: async (entry) => { opened.push(entry.name); }, refresh: async () => undefined,
    },
    files: { search: async () => [], open: async (path) => { opened.push(path); }, reveal: () => undefined },
    openUrl: async (url) => { opened.push(url); },
    webSearch: async (query) => { opened.push(`search:${query}`); },
    helperStatus: () => 'running',
    onFnKey: () => () => undefined,
    ...overrides,
  };
}

export interface FakeContextOptions {
  readonly settings?: SettingsPatch;
  readonly os?: Partial<OsServices>;
  readonly services?: Partial<Record<keyof AppContext, unknown>>;
}

export interface FakeContext {
  readonly ctx: AppContext;
  readonly bus: RecordingBus;
  readonly engine: EngineCommand[];
  readonly history: HistoryItem[];
  readonly reminders: Reminder[];
  readonly notes: Note[];
  readonly os: ReturnType<typeof fakeOs>;
  setSettings(patch: SettingsPatch): void;
}

export function createFakeContext(options: FakeContextOptions = {}): FakeContext {
  let settings: Settings = applySettingsPatch(DEFAULT_SETTINGS, options.settings ?? {});
  const bus = createBus();
  const engine: EngineCommand[] = [];
  const history: HistoryItem[] = [];
  const reminders: Reminder[] = [];
  const notes: Note[] = [];
  const os = fakeOs(options.os);
  const base = {
    isDev: true, platform: 'darwin', version: 'test', logger: silentLogger(), bus,
    settings: { get: () => settings, update: (patch: SettingsPatch) => (settings = applySettingsPatch(settings, patch)) },
    secrets: { get: () => 'test-key', set: vi.fn(), clear: vi.fn(), status: vi.fn(), isEncryptionAvailable: () => true },
    windows: {
      engine: { send: (command: EngineCommand) => engine.push(command), isReady: () => true, markReady: () => undefined },
      island: { show: vi.fn(), hide: vi.fn(), setInteractive: vi.fn() },
      palette: { show: vi.fn(), hide: vi.fn(), isVisible: () => false, resize: vi.fn() },
      dashboard: { show: vi.fn(), hide: vi.fn(), isVisible: () => false },
    },
    os,
    history: { add: (item: HistoryItem) => history.push(item), list: () => history, get: () => null, update: () => null, delete: vi.fn(), clear: vi.fn(), recent: () => history },
    dictionary: { terms: () => ['Oxaliplatin'], apply: (text: string) => text.replace(/ox ally platin/gi, 'Oxaliplatin'), list: () => [], upsert: vi.fn(), delete: vi.fn(), learnFrom: async () => undefined },
    knowledge: { relevant: () => [], list: () => [], upsert: vi.fn((input) => ({ ...input, id: 'f1' })), delete: vi.fn(), graph: vi.fn(), extractFrom: async () => [] },
    reminders: {
      start: vi.fn(), stop: vi.fn(), list: () => reminders, cancel: vi.fn(),
      create: (input: { kind: 'reminder' | 'timer'; text: string; dueAt?: string; inMinutes?: number }) => {
        const reminder: Reminder = { id: `r${reminders.length + 1}`, kind: input.kind, text: input.text, dueAt: input.dueAt ?? new Date(Date.now() + (input.inMinutes ?? 0) * 60_000).toISOString(), repeat: 'none', status: 'scheduled', createdAt: new Date().toISOString(), firedAt: null };
        reminders.push(reminder);
        return reminder;
      },
    },
    notes: {
      list: () => notes, delete: vi.fn(),
      upsert: (input: { title: string; body: string }) => {
        const note: Note = { id: `n${notes.length + 1}`, title: input.title, body: input.body, pinned: false, source: 'agent', createdAt: '', updatedAt: '' };
        notes.push(note);
        return note;
      },
    },
    search: { search: () => [], invalidate: vi.fn() },
    stt: { isConfigured: () => true, transcribe: vi.fn(), test: vi.fn() },
    llm: { isConfigured: () => true, complete: vi.fn(), stream: vi.fn(), test: vi.fn() },
    agent: { ask: vi.fn(), run: vi.fn(), confirm: vi.fn(), cancel: vi.fn() } satisfies AgentService,
    voice: { start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), snapshot: vi.fn(), handleFnKey: vi.fn(), onCapture: vi.fn(), onClap: vi.fn(), onWake: vi.fn(), onEngineError: vi.fn() } satisfies VoiceService,
    ...options.services,
  };
  // Test double: only the services these modules use are implemented.
  const ctx = base as unknown as AppContext;
  return { ctx, bus, engine, history, reminders, notes, os, setSettings: (patch) => { settings = applySettingsPatch(settings, patch); } };
}
