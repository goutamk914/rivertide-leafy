import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentEvent, PendingConfirmation } from '../../../src/shared/types';
import type { AgentTurnResult, LlmProvider } from '../../../src/main/ai/llm/types';
import type { ProviderRegistry } from '../../../src/main/ai/llm/registry';
import { createAgentService } from '../../../src/main/agent';
import { executeCall, type ExecutorDeps } from '../../../src/main/agent/executor';
import { runAgentLoop } from '../../../src/main/agent/loop';
import { effectivePolicy } from '../../../src/main/agent/policy';
import type { AnyTool } from '../../../src/main/agent/tools';
import { defineTool, ok, type ToolContext } from '../../../src/main/agent/tools/types';
import { createFakeContext } from './fake-context';

const started: string[] = [];
const hangTool = defineTool({
  name: 'hang', description: 'Never finishes and ignores its signal', risk: 'act', schema: z.object({ n: z.number() }),
  title: ({ n }) => `Hang ${n}`, run: ({ n }) => { started.push(`hang ${n}`); return new Promise(() => undefined); },
});
const askTool = defineTool({
  name: 'ask_first', description: 'Needs approval', risk: 'confirm', schema: z.object({}),
  title: () => 'Risky', run: async () => { started.push('ask_first'); return ok('Done.'); },
});
const TOOLS = [hangTool, askTool] as unknown as readonly AnyTool[];

function executorDeps(signal: AbortSignal, confirm: ExecutorDeps['confirm'] = async () => true): ExecutorDeps {
  const { ctx } = createFakeContext();
  return {
    runId: 'run1', tools: new Map(TOOLS.map((tool) => [tool.name, tool])), policyFor: (tool, tainted) => effectivePolicy(tool, {}, tainted),
    emit: () => undefined, confirm, signal, toolTimeoutMs: 60_000, newId: () => 'c',
    toolContext: (toolSignal): ToolContext => ({ app: ctx, os: null, now: () => new Date(), signal: toolSignal, source: 'voice', remember: () => undefined }),
  };
}

describe('cancel and timeout stop the work', () => {
  it('executeCall refuses to start (or ask) once the run is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const asked: PendingConfirmation[] = [];
    started.length = 0;

    const result = await executeCall(executorDeps(controller.signal, async (c) => { asked.push(c); return true; }), { id: 't', name: 'ask_first', input: {} }, false);

    expect(result.entry).toMatchObject({ isError: true, content: 'Stopped.' });
    expect(asked).toEqual([]);
    expect(started).toEqual([]);
  });

  it('a tool that ignores its signal is abandoned as soon as the run is cancelled', async () => {
    const controller = new AbortController();
    const pending = executeCall(executorDeps(controller.signal), { id: 't', name: 'hang', input: { n: 1 } }, false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect((await pending).outcome).toEqual({ ok: false, summary: 'Stopped.' });
  });

  it('the loop never starts the remaining calls of a round after a timeout', async () => {
    started.length = 0;
    const { ctx } = createFakeContext();
    const turn: AgentTurnResult = { text: '', stop: 'tool_use', native: null, model: 'm', toolCalls: [{ id: 'a', name: 'hang', input: { n: 1 } }, { id: 'b', name: 'hang', input: { n: 2 } }] };
    const deps = executorDeps(new AbortController().signal);

    const result = await runAgentLoop({
      provider: { agentTurn: async () => turn }, model: 'm', system: 's', history: [], userText: 'x', contextText: 'c', toolSpecs: [],
      executor: { ...deps, toolContext: (signal) => ({ app: ctx, os: null, now: () => new Date(), signal, source: 'voice', remember: () => undefined }) },
      signal: new AbortController().signal, onText: () => undefined, limits: { totalMs: 30 },
    });

    expect(result.stop).toBe('timeout');
    expect(started).toEqual(['hang 1']);
  });
});

describe('agent service cancel', () => {
  function registry(turn: AgentTurnResult): ProviderRegistry {
    const provider: LlmProvider = { id: 'anthropic', complete: async () => ({ text: '', model: 'm' }), stream: async () => ({ text: '', model: 'm' }), agentTurn: async () => turn };
    return { get: () => provider, isProviderConfigured: () => true, isRoleConfigured: () => true, resolve: () => ({ provider, providerId: 'anthropic', model: 'm' }) };
  }

  it('resolves run() promptly when cancelled during a hung tool', async () => {
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, {
      tools: TOOLS, registry: registry({ text: '', stop: 'tool_use', native: null, model: 'm', toolCalls: [{ id: 'a', name: 'hang', input: { n: 1 } }] }),
    });

    const pending = agent.run('do something slow', 'voice');
    await new Promise((resolve) => setTimeout(resolve, 5));
    agent.cancel(fake.bus.of('agent:event')[0].runId);

    expect(await pending).toMatchObject({ ok: false, reply: 'Okay, I stopped.' });
  });

  it('a late "yes" after cancel cannot approve anything', async () => {
    started.length = 0;
    const fake = createFakeContext();
    const agent = createAgentService(fake.ctx, {
      tools: TOOLS, registry: registry({ text: '', stop: 'tool_use', native: null, model: 'm', toolCalls: [{ id: 'a', name: 'ask_first', input: {} }] }),
    });

    const pending = agent.run('do the risky thing', 'voice');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const confirm = fake.bus.of('agent:event').find((event): event is Extract<AgentEvent, { type: 'tool-confirm' }> => event.type === 'tool-confirm');
    expect(confirm).toBeDefined();
    agent.cancel(confirm!.runId);
    agent.confirm(confirm!.runId, confirm!.confirmation.callId, true);
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(started).toEqual([]);
  });
});
