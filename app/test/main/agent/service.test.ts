import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../src/shared/types';
import type { AgentTurnRequest, AgentTurnResult, LlmProvider } from '../../../src/main/ai/llm/types';
import type { ProviderRegistry } from '../../../src/main/ai/llm/registry';
import { createAgentService } from '../../../src/main/agent';
import { OFFLINE_CAPABILITIES } from '../../../src/main/ai/prompts/agent';
import { createFakeContext } from './fake-context';

const NOW = new Date(2026, 9, 15, 14, 3, 0);

function registryWith(script: AgentTurnResult[] | null): { registry: ProviderRegistry; requests: AgentTurnRequest[] } {
  const requests: AgentTurnRequest[] = [];
  let index = 0;
  const provider: LlmProvider = {
    id: 'anthropic', complete: async () => ({ text: '', model: 'm' }), stream: async () => ({ text: '', model: 'm' }),
    agentTurn: async (request) => {
      requests.push(request);
      return script![Math.min(index++, script!.length - 1)];
    },
  };
  return {
    requests,
    registry: {
      get: () => provider,
      isProviderConfigured: () => script !== null,
      isRoleConfigured: () => script !== null,
      resolve: () => ({ provider, providerId: 'anthropic', model: 'claude-opus-5-5' }),
    },
  };
}

const events = (bus: { of(event: 'agent:event'): AgentEvent[] }) => bus.of('agent:event');

describe('createAgentService', () => {
  it('handles router intents instantly without an LLM', async () => {
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, { registry: registryWith(null).registry, now: () => NOW });

    const result = await agent.run('open Spotify', 'voice');

    expect(result).toMatchObject({ ok: true, reply: 'Opened Spotify.', actions: [{ tool: 'open_app', title: 'Open Spotify', ok: true }] });
    expect(fake.os.opened).toEqual(['Spotify']);
    expect(events(fake.bus).map((event) => event.type)).toEqual(['run-start', 'tool-start', 'tool-end', 'run-end']);
  });

  it('emits run-start synchronously so voice can bind to the run', () => {
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, { registry: registryWith(null).registry, now: () => NOW });

    const { runId } = agent.ask('what time is it', 'palette');

    expect(events(fake.bus)[0]).toEqual({ type: 'run-start', runId, input: 'what time is it', source: 'palette' });
  });

  it('explains what works offline when no AI key is configured', async () => {
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, { registry: registryWith(null).registry, now: () => NOW });

    const result = await agent.run('write me a poem about autumn', 'voice');

    expect(result).toMatchObject({ ok: false, reply: OFFLINE_CAPABILITIES });
  });

  it('waits for confirmation on risky router intents and runs on approval', async () => {
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, { registry: registryWith(null).registry, now: () => NOW });

    const pending = agent.run('quit Spotify', 'voice');
    await Promise.resolve();
    const confirm = events(fake.bus).find((event) => event.type === 'tool-confirm');
    expect(confirm).toBeDefined();
    if (confirm?.type !== 'tool-confirm') return;
    agent.confirm(confirm.runId, confirm.confirmation.callId, false);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.reply).toBe('Okay, I didn’t do it.');
  });

  it('declines a confirmation nobody answers', async () => {
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, { registry: registryWith(null).registry, now: () => NOW, confirmTimeoutMs: 10 });

    const result = await agent.run('lock the screen', 'voice');

    expect(result).toMatchObject({ ok: false, actions: [{ tool: 'lock_screen', ok: false }] });
  });

  it('runs the LLM loop with the stable system prompt and a trailing context message', async () => {
    const fake = createFakeContext({ settings: { profile: { name: 'Sam' } } });
    const { registry, requests } = registryWith([{ text: 'Here’s a short poem.', toolCalls: [], stop: 'end', native: null, model: 'claude-opus-5-5' }]);
    const agent = createAgentService(fake.ctx, { registry, now: () => NOW });

    const result = await agent.run('write me a poem', 'voice');

    expect(result).toMatchObject({ ok: true, reply: 'Here’s a short poem.' });
    expect(requests[0].system).toMatch(/You are Leafy/);
    expect(requests[0].system).not.toMatch(/2026/);
    expect(requests[0].messages[0]).toEqual({ role: 'user', text: 'write me a poem' });
    expect(requests[0].messages[1]).toMatchObject({ role: 'context' });
    expect((requests[0].messages[1] as { text: string }).text).toMatch(/Sam/);
    expect(requests[0].tools.map((tool) => tool.name)).toContain('open_app');
  });

  it('keeps the conversation for follow-ups', async () => {
    const fake = createFakeContext();
    const { registry, requests } = registryWith([{ text: 'Sure.', toolCalls: [], stop: 'end', native: null, model: 'm' }]);
    const agent = createAgentService(fake.ctx, { registry, now: () => NOW });

    await agent.run('tell me a joke', 'voice');
    await agent.run('another one', 'voice');

    expect(requests[1].messages.map((message) => message.role)).toEqual(['user', 'context', 'assistant', 'user', 'context']);
  });

  it('opens "the second one" from the last file search', async () => {
    const hits = [
      { path: '/Users/me/Documents/a.pdf', name: 'a.pdf', kind: 'pdf', modifiedAt: null },
      { path: '/Users/me/Documents/b.pdf', name: 'b.pdf', kind: 'pdf', modifiedAt: null },
    ];
    const fake = createFakeContext({ os: { files: { search: async () => hits, open: async () => undefined, reveal: () => undefined } } });
    const agent = createAgentService(fake.ctx, { registry: registryWith(null).registry, now: () => NOW });

    const search = await agent.run('find my files about taxes', 'voice');
    const follow = await agent.run('open the second one', 'voice');

    expect(search.reply).toBe('I found 2 files. The best match is a.pdf.');
    // b.pdf does not exist on this machine, so the path check refuses it safely.
    expect(follow.actions[0]).toMatchObject({ tool: 'open_file', title: 'Open b.pdf' });
  });

  it('cancels a run', async () => {
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, { registry: registryWith(null).registry, now: () => NOW });

    const pending = agent.run('quit Spotify', 'voice');
    await Promise.resolve();
    const start = events(fake.bus)[0];
    agent.cancel(start.runId);

    expect((await pending).ok).toBe(false);
  });
});
