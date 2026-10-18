/**
 * Minimal fakes for AppContext services used by the core tests. Every method is a vi.fn so tests
 * can assert calls; override any service with `fakeContext({ ... })`.
 */
import { vi } from 'vitest';
import { createBus } from '../../../src/main/bus';
import type {
  AppContext, EventBus, JsonStore, Logger, Paths, WindowsService,
} from '../../../src/main/services';
import { DEFAULT_SETTINGS, applySettingsPatch, type Settings, type SettingsPatch } from '../../../src/shared/settings';

export interface LogEntry { readonly level: string; readonly scope: string; readonly message: string; readonly meta?: Record<string, unknown> }

export function memoryLogger(entries: LogEntry[] = [], scope = ''): Logger & { entries: LogEntry[] } {
  const write = (level: string) => (message: string, meta?: Record<string, unknown>) => {
    entries.push({ level, scope, message, meta });
  };
  return {
    entries,
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (child: string) => memoryLogger(entries, scope ? `${scope}:${child}` : child),
  };
}

export function memoryStore<T>(initial: T): JsonStore<T> & { writes: T[] } {
  let value = initial;
  const writes: T[] = [];
  return {
    writes,
    read: () => value,
    write: (next) => {
      value = next;
      writes.push(next);
    },
    update: (fn) => {
      value = fn(value);
      writes.push(value);
      return value;
    },
    flush: vi.fn(async () => undefined),
  };
}

export const FAKE_PATHS: Paths = {
  userData: '/tmp/rt/user',
  data: '/tmp/rt/user/data',
  documents: '/tmp/rt/user/documents',
  media: '/tmp/rt/user/media',
  logs: '/tmp/rt/logs',
  exports: '/tmp/rt/exports',
  resources: '/tmp/rt/resources',
};

export function fakeSettingsService(initial: Settings = DEFAULT_SETTINGS, bus?: EventBus) {
  let current = initial;
  return {
    get: vi.fn(() => current),
    update: vi.fn((patch: SettingsPatch) => {
      current = applySettingsPatch(current, patch);
      bus?.emit('settings:changed', current);
      return current;
    }),
  };
}

export function fakeWindows(): WindowsService {
  return {
    start: vi.fn(async () => undefined),
    dashboard: { show: vi.fn(), hide: vi.fn(), isVisible: vi.fn(() => false) },
    palette: { show: vi.fn(), hide: vi.fn(), isVisible: vi.fn(() => false), resize: vi.fn() },
    island: { show: vi.fn(), hide: vi.fn(), setInteractive: vi.fn() },
    leafy: {
      show: vi.fn(), hide: vi.fn(), isVisible: vi.fn(() => true), setInteractive: vi.fn(), moveTo: vi.fn(),
      persistPosition: vi.fn(), position: vi.fn(() => ({ x: 10, y: 20, corner: 'right' as const })), popupMenu: vi.fn(),
      applySize: vi.fn(),
    },
    engine: { send: vi.fn(), isReady: vi.fn(() => true), markReady: vi.fn() },
    broadcast: vi.fn(),
    kindOf: vi.fn(() => 'dashboard' as const),
  };
}

/** A complete AppContext made of fakes; feature services are bags of vi.fn. */
export function fakeContext(overrides: Partial<AppContext> = {}): AppContext {
  const logger = overrides.logger ?? memoryLogger();
  const bus = overrides.bus ?? createBus(() => undefined);
  const stub = <T>(methods: Record<string, unknown>): T => methods as T;
  const base: AppContext = {
    isDev: false,
    platform: 'darwin',
    version: '2.0.0-test',
    paths: FAKE_PATHS,
    logger,
    bus,
    settings: fakeSettingsService(DEFAULT_SETTINGS, bus),
    secrets: stub({ get: vi.fn(() => null), set: vi.fn(), clear: vi.fn(), status: vi.fn(), isEncryptionAvailable: vi.fn(() => true) }),
    windows: fakeWindows(),
    permissions: stub({ status: vi.fn(), request: vi.fn(), openSettings: vi.fn(async () => undefined) }),
    openStore: <T>(_name: string, options: { readonly defaults: T }) => memoryStore(options.defaults),
    llm: stub({ isConfigured: vi.fn(), complete: vi.fn(), stream: vi.fn(), test: vi.fn() }),
    stt: stub({ isConfigured: vi.fn(), transcribe: vi.fn(), test: vi.fn() }),
    os: stub({ start: vi.fn(async () => undefined), stop: vi.fn(), helperStatus: vi.fn(() => 'running') }),
    voice: stub({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), onCapture: vi.fn(async () => undefined), onClap: vi.fn(), onWake: vi.fn(), onEngineError: vi.fn() }),
    agent: stub({ ask: vi.fn(), run: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }),
    hotkeys: stub({ start: vi.fn(), stop: vi.fn(), reload: vi.fn(() => []), status: vi.fn(() => []) }),
    history: stub({}),
    knowledge: stub({ extractFrom: vi.fn(async () => []) }),
    dictionary: stub({ learnFrom: vi.fn(async () => undefined) }),
    documents: stub({}),
    search: stub({ invalidate: vi.fn(), search: vi.fn(() => []) }),
    chat: stub({}),
    notes: stub({}),
    reminders: stub({ start: vi.fn(), stop: vi.fn() }),
    insights: stub({ start: vi.fn() }),
    palette: stub({}),
  };
  return { ...base, ...overrides };
}

/** Lets setImmediate-scheduled background jobs run. */
export const flushBackground = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
