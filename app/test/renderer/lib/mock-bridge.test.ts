import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVOKE_CHANNELS, type InvokeChannel } from '../../../src/shared/ipc-channels';
import type { InvokeRequest } from '../../../src/shared/ipc';
import { createMockBridge, type MockBridge } from '../../../src/renderer/lib/mock-bridge';
import { seedState } from '../../../src/renderer/lib/mock/data';
import { buildGraph } from '../../../src/renderer/lib/mock/handlers-content';
import { dynamicsSummary, fogLabel, usageSummary } from '../../../src/renderer/lib/mock/insights';

const NOW = new Date('2026-10-15T15:00:00.000Z');

/** A valid request for every channel, typed against the contract. */
function sampleRequests(bridge: MockBridge): { [C in InvokeChannel]: InvokeRequest<C> } {
  const s = bridge.getState();
  const historyId = s.history[0]?.id ?? 'x';
  const factId = s.facts[0]?.id ?? 'x';
  const dictId = s.dictionary[0]?.id ?? 'x';
  const docId = s.documents[0]?.meta.id ?? 'x';
  const chatId = s.chats[0]?.id ?? 'x';
  const noteId = s.notes[0]?.id ?? 'x';
  const reminderId = s.reminders[0]?.id ?? 'x';
  const stats = { durationMs: 1, speechMs: 1, segments: 1, pauseCount: 0, longPauseCount: 0, meanPauseMs: 0, maxPauseMs: 0, speechLevelDb: -30 };
  return {
    'app:info': undefined, 'settings:get': undefined, 'settings:update': { patch: { profile: { name: 'Ari' } } },
    'secrets:status': undefined, 'secrets:set': { id: 'openai', value: 'sk-test-value' }, 'secrets:clear': { id: 'openai' },
    'providers:test': { kind: 'llm', providerId: 'anthropic' }, 'permissions:status': undefined,
    'permissions:request': { kind: 'microphone' }, 'permissions:openSettings': { kind: 'accessibility' }, 'hotkeys:status': undefined,
    'history:list': { limit: 5 }, 'history:get': { id: historyId }, 'history:repaste': { id: historyId },
    'history:delete': { id: historyId }, 'history:clear': { confirm: true },
    'knowledge:list': {}, 'knowledge:upsert': { fact: { category: 'goal', label: 'Rest', value: 'Nap after lunch.' } },
    'knowledge:delete': { id: factId }, 'knowledge:graph': undefined,
    'dictionary:list': undefined, 'dictionary:upsert': { entry: { term: 'Capecitabine', replaces: ['cape city bean'] } },
    'dictionary:delete': { id: dictId },
    'documents:list': undefined, 'documents:pick': undefined, 'documents:importText': { name: 'a.txt', text: 'hello' },
    'documents:get': { id: docId }, 'documents:delete': { id: docId },
    'chat:list': undefined, 'chat:get': { id: chatId }, 'chat:create': undefined, 'chat:rename': { id: chatId, title: 'Renamed' },
    'chat:send': { sessionId: chatId, text: 'Hello' }, 'chat:delete': { id: chatId },
    'notes:list': {}, 'notes:upsert': { note: { title: 'T', body: 'B' } }, 'notes:delete': { id: noteId },
    'reminders:list': undefined, 'reminders:create': { kind: 'timer', text: 'Tea', inMinutes: 5 }, 'reminders:cancel': { id: reminderId },
    'insights:usage': { days: 7 }, 'insights:dynamics': { days: 14 },
    'voice:snapshot': undefined, 'voice:start': { mode: 'dictate', source: 'dashboard' }, 'voice:stop': undefined, 'voice:cancel': undefined,
    'agent:ask': { text: 'Find my notes', source: 'dashboard' }, 'agent:confirm': { runId: 'r', callId: 'c', approved: true }, 'agent:cancel': { runId: 'r' },
    'palette:search': { query: 'Oxali' }, 'palette:execute': { id: 'ask' }, 'palette:hide': undefined, 'palette:resize': { height: 200 },
    'leafy:pointer': { interactive: true }, 'leafy:moveTo': { x: 1, y: 2 }, 'leafy:dragEnd': undefined, 'leafy:menu': undefined, 'leafy:position': undefined,
    'island:pointer': { interactive: false }, 'window:open': { target: 'dashboard', route: '/history' }, 'window:close': undefined, 'window:minimize': undefined,
    'data:export': undefined, 'data:wipe': { confirm: 'DELETE' }, 'system:openExternal': { url: 'https://codethecure.org' },
    'engine:ready': undefined, 'engine:capture': { requestId: 'q', reason: 'stopped', wav: null, stats }, 'engine:clap': { at: 1 },
    'engine:voices': { voices: [] }, 'engine:error': { scope: 'mic', message: 'x' },
  };
}

describe('mock bridge', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = createMockBridge({ latencyMs: 0, now: () => NOW });
  });

  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });

  it('answers every invoke channel in the contract', async () => {
    for (const channel of INVOKE_CHANNELS) {
      // Arrange: a fresh bridge per channel so earlier deletes don't affect later lookups.
      const fresh = createMockBridge({ latencyMs: 0, now: () => NOW });
      const request = sampleRequests(fresh)[channel];

      // Act + Assert
      await expect(fresh.invoke(channel, request as never), channel).resolves.toBeDefined();
      fresh.dispose();
    }
  });

  it('rejects requests that fail the contract schema', async () => {
    await expect(bridge.invoke('history:get', { id: '' })).rejects.toThrow(/history:get/);
    await expect(bridge.invoke('data:wipe', { confirm: 'delete' } as never)).rejects.toThrow();
  });

  it('applies settings patches, emits settings:changed and rejects invalid values', async () => {
    // Arrange
    const listener = vi.fn();
    bridge.on('settings:changed', listener);

    // Act
    const next = await bridge.invoke('settings:update', { patch: { appearance: { textScale: 1.2 } } });

    // Assert
    expect(next.appearance.textScale).toBe(1.2);
    expect(listener).toHaveBeenCalledWith(next);
    await expect(bridge.invoke('settings:update', { patch: { appearance: { textScale: 9 } } })).rejects.toThrow(/isn’t allowed/);
  });

  it('never stores secret values, only a flag', async () => {
    await bridge.invoke('secrets:set', { id: 'openai', value: 'sk-very-secret' });
    expect(JSON.stringify(bridge.getState())).not.toContain('sk-very-secret');
    expect(bridge.getState().secrets.openai.set).toBe(true);
  });

  it('filters history by mode and query and pages with before', async () => {
    const asks = await bridge.invoke('history:list', { mode: 'ask' });
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.every((h) => h.mode === 'ask')).toBe(true);
    const first = await bridge.invoke('history:list', { limit: 3 });
    const older = await bridge.invoke('history:list', { limit: 3, before: first[2]?.createdAt });
    expect(older.every((h) => h.createdAt < (first[2]?.createdAt ?? ''))).toBe(true);
    const none = await bridge.invoke('history:list', { query: 'zzzz-nothing' });
    expect(none).toEqual([]);
  });

  it('emits data:changed after content mutations', async () => {
    const listener = vi.fn();
    bridge.on('data:changed', listener);
    await bridge.invoke('notes:upsert', { note: { title: 'New', body: '' } });
    expect(listener).toHaveBeenCalledWith({ domain: 'notes' });
  });

  it('streams chat replies as deltas then a final message', async () => {
    // Arrange
    const events: string[] = [];
    bridge.on('chat:event', (e) => events.push(e.type));
    const chatId = bridge.getState().chats[0]?.id ?? '';

    // Act
    const ids = await bridge.invoke('chat:send', { sessionId: chatId, text: 'How was my energy?' });
    await vi.runAllTimersAsync();

    // Assert
    expect(ids.assistantMessageId).toBeTruthy();
    expect(events[0]).toBe('delta');
    expect(events[events.length - 1]).toBe('done');
    const session = await bridge.invoke('chat:get', { id: chatId });
    expect(session?.messages.at(-1)?.role).toBe('assistant');
  });

  it('reports a chat error when asked to fail', async () => {
    const events: string[] = [];
    bridge.on('chat:event', (e) => events.push(e.type));
    const chatId = bridge.getState().chats[0]?.id ?? '';
    await bridge.invoke('chat:send', { sessionId: chatId, text: 'please fail now' });
    await vi.runAllTimersAsync();
    expect(events).toEqual(['error']);
  });

  it('walks a voice session through listening to done and back to idle', async () => {
    // Arrange
    const phases: string[] = [];
    bridge.on('voice:snapshot', (s) => phases.push(s.phase));
    const levels = vi.fn();
    bridge.on('audio:level', levels);

    // Act
    await bridge.invoke('voice:start', { mode: 'dictate', source: 'dashboard' });
    await vi.runAllTimersAsync();

    // Assert
    expect(phases).toEqual(['listening', 'transcribing', 'thinking', 'done', 'idle']);
    expect(levels).toHaveBeenCalled();
  });

  it('cancels a voice session immediately', async () => {
    await bridge.invoke('voice:start', { mode: 'command', source: 'dashboard' });
    const snapshot = await bridge.invoke('voice:cancel', undefined);
    expect(snapshot.phase).toBe('idle');
  });

  it('runs a simulated agent run', async () => {
    const types: string[] = [];
    bridge.on('agent:event', (e) => types.push(e.type));
    await bridge.invoke('agent:ask', { text: 'find notes', source: 'dashboard' });
    await vi.runAllTimersAsync();
    expect(types).toEqual(['run-start', 'tool-start', 'tool-end', 'text', 'run-end']);
  });

  it('turns window:open with a route into a navigate event', async () => {
    const listener = vi.fn();
    bridge.on('navigate', listener);
    await bridge.invoke('window:open', { target: 'dashboard', route: '/insights' });
    expect(listener).toHaveBeenCalledWith({ route: '/insights' });
  });

  it('wipes content and resets onboarding', async () => {
    await bridge.invoke('data:wipe', { confirm: 'DELETE' });
    const state = bridge.getState();
    expect(state.history).toEqual([]);
    expect(state.settings.onboarded).toBe(false);
  });

  it('reports provider test failures in plain words', async () => {
    await bridge.invoke('secrets:clear', { id: 'openai' });
    expect((await bridge.invoke('providers:test', { kind: 'llm', providerId: 'openai' })).message).toMatch(/Add a OpenAI key first/);
    expect((await bridge.invoke('providers:test', { kind: 'llm', providerId: 'ollama' })).ok).toBe(false);
    expect((await bridge.invoke('providers:test', { kind: 'llm', providerId: 'anthropic' })).ok).toBe(true);
  });

  it('grants accessibility a moment after opening System Settings', async () => {
    bridge.setState((s) => ({ ...s, permissions: { ...s.permissions, accessibility: false } }));
    await bridge.invoke('permissions:openSettings', { kind: 'accessibility' });
    await vi.runAllTimersAsync();
    expect((await bridge.invoke('permissions:status', undefined)).accessibility).toBe(true);
  });
});

describe('mock sample data', () => {
  it('has history for today and a quiet day', () => {
    const state = seedState(NOW);
    const usage = usageSummary(state.history, 14, NOW);
    expect(usage.daily.at(-1)?.sessions).toBeGreaterThan(0);
    expect(usage.daily.some((d) => d.sessions === 0)).toBe(true);
    expect(usage.streakDays).toBeGreaterThan(0);
    expect(usage.topApps.length).toBeGreaterThan(0);
  });

  it('produces a ready baseline with a latest reading', () => {
    const state = seedState(NOW);
    const summary = dynamicsSummary(state.dynamics, 14, NOW);
    expect(summary.baselineReady).toBe(true);
    expect(summary.latest).not.toBeNull();
    expect(summary.daily).toHaveLength(14);
    expect(dynamicsSummary(state.dynamics.slice(0, 2), 14, NOW).baselineReady).toBe(false);
  });

  it('labels fog levels at the thresholds', () => {
    expect(fogLabel(10)).toBe('steady');
    expect(fogLabel(39)).toBe('steady');
    expect(fogLabel(40)).toBe('a-little-foggy');
    expect(fogLabel(65)).toBe('foggy');
  });

  it('builds a graph with you at the centre and a hub per category', () => {
    const graph = buildGraph(seedState(NOW).facts);
    const self = graph.nodes.filter((n) => n.kind === 'self');
    expect(self).toHaveLength(1);
    const hubs = graph.nodes.filter((n) => n.kind === 'category');
    expect(graph.links.filter((l) => l.source === 'self')).toHaveLength(hubs.length);
  });
});
