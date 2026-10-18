import { describe, expect, it } from 'vitest';
import type { InvokeChannel } from '../../../src/shared/ipc-channels';
import { invokeSchemas } from '../../../src/shared/ipc';
import type { AppContext } from '../../../src/main/services';
import type { Handle, HandleOptions, SenderInfo } from '../../../src/main/ipc/types';
import { registerChatHandlers } from '../../../src/main/ipc/handlers/chat';
import { registerDictionaryHandlers } from '../../../src/main/ipc/handlers/dictionary';
import { registerDocumentsHandlers } from '../../../src/main/ipc/handlers/documents';
import { registerHistoryHandlers } from '../../../src/main/ipc/handlers/history';
import { registerInsightsHandlers } from '../../../src/main/ipc/handlers/insights';
import { registerKnowledgeHandlers } from '../../../src/main/ipc/handlers/knowledge';
import { registerNotesHandlers } from '../../../src/main/ipc/handlers/notes';
import { registerPaletteHandlers } from '../../../src/main/ipc/handlers/palette';
import { registerRemindersHandlers } from '../../../src/main/ipc/handlers/reminders';
import { createFakeContext, makeHistoryItem } from './fake-context';

const SENDER: SenderInfo = { kind: 'dashboard', webContentsId: 1 };
type AnyHandler = (request: unknown, sender: SenderInfo) => unknown;

function registerAll(ctx: AppContext) {
  const handlers = new Map<string, { handler: AnyHandler; options?: HandleOptions }>();
  const handle: Handle = (channel, handler, options) => {
    if (handlers.has(channel)) throw new Error(`duplicate handler ${channel}`);
    handlers.set(channel, { handler: handler as AnyHandler, options });
  };
  for (const register of [registerHistoryHandlers, registerKnowledgeHandlers, registerDictionaryHandlers, registerDocumentsHandlers,
    registerChatHandlers, registerNotesHandlers, registerRemindersHandlers, registerInsightsHandlers, registerPaletteHandlers]) {
    register(ctx, handle);
  }
  /** Validates like ipc/register.ts, then calls the handler. */
  const call = async (channel: InvokeChannel, request: unknown = {}) => {
    const entry = handlers.get(channel);
    if (!entry) throw new Error(`no handler for ${channel}`);
    const parsed = invokeSchemas[channel].parse(request);
    return entry.handler(parsed, SENDER);
  };
  return { handlers, call };
}

const NAMESPACES = ['history', 'knowledge', 'dictionary', 'documents', 'chat', 'notes', 'reminders', 'insights', 'palette'];

describe('memory IPC handlers', () => {
  it('registers every channel in the memory namespaces exactly once', () => {
    const { ctx } = createFakeContext();
    const { handlers } = registerAll(ctx);
    const expected = Object.keys(invokeSchemas).filter((channel) => NAMESPACES.includes(channel.split(':')[0]));
    expect([...handlers.keys()].sort()).toEqual(expected.sort());
  });

  it('routes history channels, including repaste of the polished output', async () => {
    // Arrange
    const { ctx, os } = createFakeContext();
    const { call } = registerAll(ctx);
    ctx.history.add(makeHistoryItem({ id: 'h1', output: 'Polished words.' }));
    ctx.history.add(makeHistoryItem({ id: 'h2', output: '', raw: '' , createdAt: '2026-10-15T13:00:00.000Z' }));

    // Act
    const listed = await call('history:list', { limit: 5 });
    const pasted = await call('history:repaste', { id: 'h1' });

    // Assert
    expect((listed as unknown[]).length).toBe(2);
    expect(pasted).toEqual({ pasted: true });
    expect(os.paste).toHaveBeenCalledWith('Polished words.', null);
    await expect(call('history:repaste', { id: 'h2' })).rejects.toThrow(/no text/);
    await expect(call('history:repaste', { id: 'zz' })).rejects.toThrow(/no longer in your history/);
    expect(await call('history:get', { id: 'h1' })).toMatchObject({ id: 'h1' });
    expect(await call('history:delete', { id: 'h1' })).toEqual({ ok: true });
    expect(await call('history:clear', { confirm: true })).toEqual({ ok: true });
    expect(ctx.history.recent(5)).toEqual([]);
  });

  it('routes knowledge, dictionary, notes and documents channels', async () => {
    const { ctx } = createFakeContext();
    const { call } = registerAll(ctx);
    const fact = await call('knowledge:upsert', { fact: { category: 'goal', label: 'Walk', value: 'Daily' } }) as { id: string };
    expect(await call('knowledge:list', {})).toHaveLength(1);
    expect((await call('knowledge:graph') as { nodes: unknown[] }).nodes).toHaveLength(3);
    expect(await call('knowledge:delete', { id: fact.id })).toEqual({ ok: true });

    const entry = await call('dictionary:upsert', { entry: { term: 'Neulasta', replaces: ['new last a'] } }) as { id: string; source: string };
    expect(entry.source).toBe('manual');
    expect(await call('dictionary:list')).toHaveLength(1);
    expect(await call('dictionary:delete', { id: entry.id })).toEqual({ ok: true });

    const note = await call('notes:upsert', { note: { title: 'Q', body: 'Ask about fatigue' } }) as { id: string };
    expect(await call('notes:list', { query: 'fatigue' })).toHaveLength(1);
    expect(await call('notes:delete', { id: note.id })).toEqual({ ok: true });

    const doc = await call('documents:importText', { name: 'Plan', text: 'Rest well' }) as { id: string };
    expect(await call('documents:list')).toHaveLength(1);
    expect(await call('documents:get', { id: doc.id })).toMatchObject({ text: 'Rest well' });
    expect(await call('documents:pick')).toEqual([]);
    expect(await call('documents:delete', { id: doc.id })).toEqual({ ok: true });
  });

  it('routes chat, reminders, insights and palette channels', async () => {
    const { ctx, windows } = createFakeContext();
    const { call, handlers } = registerAll(ctx);
    const session = await call('chat:create') as { id: string };
    expect(await call('chat:rename', { id: session.id, title: 'Questions' })).toMatchObject({ title: 'Questions' });
    expect(await call('chat:send', { sessionId: session.id, text: 'Hi' })).toHaveProperty('assistantMessageId');
    expect(await call('chat:list')).toHaveLength(1);
    expect(await call('chat:get', { id: session.id })).toMatchObject({ id: session.id });
    expect(await call('chat:delete', { id: session.id })).toEqual({ ok: true });

    const reminder = await call('reminders:create', { kind: 'timer', text: 'Tea', inMinutes: 3 }) as { id: string };
    expect(await call('reminders:list')).toHaveLength(1);
    expect(await call('reminders:cancel', { id: reminder.id })).toEqual({ ok: true });

    expect(await call('insights:usage', { days: 7 })).toHaveProperty('streakDays');
    expect(await call('insights:dynamics', { days: 7 })).toHaveProperty('baselineReady', false);

    expect(await call('palette:search', { query: 'settings' })).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cmd:open-settings' })]));
    expect(await call('palette:execute', { id: 'nope' })).toMatchObject({ ok: false });
    expect(await call('palette:hide')).toEqual({ ok: true });
    expect(await call('palette:resize', { height: 300 })).toEqual({ ok: true });
    expect(windows.palette.resize).toHaveBeenCalledWith(300);
    expect(handlers.get('palette:resize')?.options).toEqual({ allow: ['palette'] });
    expect(handlers.get('documents:pick')?.options).toEqual({ allow: ['dashboard'] });
  });
});
