import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../src/main/bus';
import {
  applySettingsChange, assembleContext, START_ORDER, startServices, wireBackgroundJobs, type CoreParts, type ServiceFactories,
} from '../../../src/main/compose';
import type { AppContext } from '../../../src/main/services';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/settings';
import type { HistoryItem } from '../../../src/shared/types';
import { FAKE_PATHS, fakeContext, flushBackground, memoryLogger, memoryStore } from './fakes';

function core(): CoreParts {
  return {
    isDev: false,
    platform: 'darwin',
    version: '2.0.0-test',
    paths: FAKE_PATHS,
    logger: memoryLogger(),
    bus: createBus(() => undefined),
    openStore: <T>(_name: string, options: { readonly defaults: T }) => memoryStore(options.defaults),
  };
}

/** Factories that return the matching fake service and record the context they were given. */
function fakeFactories(seen: AppContext[] = []): ServiceFactories {
  const services = fakeContext();
  const factory = <K extends keyof AppContext>(key: K) => (ctx: AppContext) => {
    seen.push(ctx);
    return services[key];
  };
  return {
    createSettingsService: factory('settings'),
    createSecretsService: factory('secrets'),
    createWindowsService: factory('windows'),
    createPermissionsService: factory('permissions'),
    createLlmRouter: factory('llm'),
    createSttService: factory('stt'),
    createOsServices: factory('os'),
    createVoiceService: factory('voice'),
    createAgentService: factory('agent'),
    createHotkeysService: factory('hotkeys'),
    createHistoryRepository: factory('history'),
    createKnowledgeService: factory('knowledge'),
    createDictionaryService: factory('dictionary'),
    createDocumentsService: factory('documents'),
    createSearchIndex: factory('search'),
    createChatService: factory('chat'),
    createNotesService: factory('notes'),
    createRemindersService: factory('reminders'),
    createInsightsService: factory('insights'),
    createPaletteService: factory('palette'),
  };
}

const item = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 'h1', createdAt: '2026-10-15T14:03:00.000Z', mode: 'dictate', source: 'fn', status: 'ok', raw: 'take oxaliplatin at nine',
  output: 'Take oxaliplatin at nine.', words: 4, durationMs: 1200, app: null, pasted: true, error: null,
  timings: { sttMs: 1, llmMs: 1, totalMs: 2 }, providers: { stt: 'groq', llm: 'anthropic' }, actions: [], audioPath: null,
  ...overrides,
});

describe('bootstrap composition (with fakes)', () => {
  it('assembles a frozen context where every factory receives the same final object', () => {
    // Arrange
    const seen: AppContext[] = [];

    // Act
    const ctx = assembleContext(core(), fakeFactories(seen));

    // Assert
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(seen).toHaveLength(20);
    seen.forEach((received) => expect(received).toBe(ctx));
    expect(ctx.windows.start).toBeDefined();
    expect(ctx.palette).toBeDefined();
  });

  it('starts services in the documented order', async () => {
    // Arrange
    const ctx = assembleContext(core(), fakeFactories());
    const order: string[] = [];
    vi.mocked(ctx.windows.start).mockImplementation(async () => { order.push('windows'); });
    vi.mocked(ctx.os.start).mockImplementation(async () => { order.push('os'); });
    vi.mocked(ctx.hotkeys.start).mockImplementation(() => { order.push('hotkeys'); });
    vi.mocked(ctx.reminders.start).mockImplementation(() => { order.push('reminders'); });
    vi.mocked(ctx.insights.start).mockImplementation(() => { order.push('insights'); });

    // Act
    const failed = await startServices(ctx);

    // Assert
    expect(order).toEqual([...START_ORDER]);
    expect(failed).toEqual([]);
  });

  it('keeps starting the rest when one service fails', async () => {
    // Arrange
    const ctx = assembleContext(core(), fakeFactories());
    vi.mocked(ctx.os.start).mockRejectedValue(new Error('helper missing'));

    // Act
    const failed = await startServices(ctx);

    // Assert
    expect(failed).toEqual(['os']);
    expect(ctx.hotkeys.start).toHaveBeenCalled();
    expect(ctx.insights.start).toHaveBeenCalled();
  });
});

describe('background jobs', () => {
  it('voice:completed runs extraction, dictionary learning and search invalidation in the background', async () => {
    // Arrange
    const ctx = fakeContext();
    wireBackgroundJobs(ctx, { setLoginItem: vi.fn() });

    // Act
    ctx.bus.emit('voice:completed', { item: item(), stats: null });
    const ranSynchronously = vi.mocked(ctx.knowledge.extractFrom).mock.calls.length;
    await flushBackground();

    // Assert
    expect(ranSynchronously).toBe(0);
    expect(ctx.knowledge.extractFrom).toHaveBeenCalledWith(item());
    expect(ctx.dictionary.learnFrom).toHaveBeenCalledWith('take oxaliplatin at nine', 'Take oxaliplatin at nine.');
    expect(ctx.search.invalidate).toHaveBeenCalledWith('history');
  });

  it('respects the knowledge settings and only learns spellings from dictation', async () => {
    // Arrange
    const ctx = fakeContext();
    ctx.settings.update({ knowledge: { autoExtract: false } });
    wireBackgroundJobs(ctx, { setLoginItem: vi.fn() });

    // Act
    ctx.bus.emit('voice:completed', { item: item({ mode: 'ask' }), stats: null });
    await flushBackground();

    // Assert
    expect(ctx.knowledge.extractFrom).not.toHaveBeenCalled();
    expect(ctx.dictionary.learnFrom).not.toHaveBeenCalled();
    expect(ctx.search.invalidate).toHaveBeenCalledWith('history');
  });

  it('a failing job is logged and never reaches the voice pipeline', async () => {
    // Arrange
    const logger = memoryLogger();
    const ctx = fakeContext({ logger });
    vi.mocked(ctx.knowledge.extractFrom).mockRejectedValue(new Error('llm down'));
    vi.mocked(ctx.search.invalidate).mockImplementation(() => { throw new Error('index broken'); });
    wireBackgroundJobs(ctx, { setLoginItem: vi.fn() });

    // Act
    const emit = () => ctx.bus.emit('voice:completed', { item: item(), stats: null });
    await flushBackground();

    // Assert
    expect(emit).not.toThrow();
    await flushBackground();
    await flushBackground();
    const labels = logger.entries.filter((e) => e.level === 'error').map((e) => e.meta?.label);
    expect(labels).toEqual(expect.arrayContaining(['knowledge.extractFrom', 'search.invalidate']));
  });

  it('settings changes reload hotkeys, show or resize Leafy and set the login item only when they change', () => {
    // Arrange
    const ctx = fakeContext();
    const setLoginItem = vi.fn();
    const base: Settings = DEFAULT_SETTINGS;
    const log = memoryLogger();

    // Act
    applySettingsChange(ctx, log, { setLoginItem }, base, { ...base, appearance: { ...base.appearance, textScale: 1.2 } });
    const callsAfterUnrelated = vi.mocked(ctx.hotkeys.reload).mock.calls.length;
    applySettingsChange(ctx, log, { setLoginItem }, base, {
      ...base,
      hotkeys: { ...base.hotkeys, palette: 'Alt+P' },
      leafy: { ...base.leafy, visible: false, size: 'large' },
      system: { launchAtLogin: true },
    });

    // Assert
    expect(callsAfterUnrelated).toBe(0);
    expect(ctx.hotkeys.reload).toHaveBeenCalledOnce();
    expect(ctx.windows.leafy.hide).toHaveBeenCalledOnce();
    expect(ctx.windows.leafy.applySize).toHaveBeenCalledWith('large');
    expect(setLoginItem).toHaveBeenCalledWith(true);
  });

  it('wires settings:changed against the previous value and unwires cleanly', () => {
    // Arrange
    const ctx = fakeContext();
    const stop = wireBackgroundJobs(ctx, { setLoginItem: vi.fn() });

    // Act
    ctx.settings.update({ leafy: { visible: false } });
    ctx.settings.update({ leafy: { visible: true } });
    stop();
    ctx.settings.update({ leafy: { visible: false } });

    // Assert
    expect(ctx.windows.leafy.hide).toHaveBeenCalledOnce();
    expect(ctx.windows.leafy.show).toHaveBeenCalledOnce();
  });
});
