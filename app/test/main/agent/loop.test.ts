import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentEvent, PendingConfirmation } from '../../../src/shared/types';
import type { AgentMessage, AgentTurnRequest, AgentTurnResult } from '../../../src/main/ai/llm/types';
import { LlmError } from '../../../src/main/ai/llm/errors';
import { runAgentLoop, type LoopInput } from '../../../src/main/agent/loop';
import { effectivePolicy } from '../../../src/main/agent/policy';
import { defineTool, ok, type ToolContext } from '../../../src/main/agent/tools/types';
import type { AnyTool } from '../../../src/main/agent/tools';
import { createFakeContext } from './fake-context';

const echoTool = defineTool({
  name: 'echo', description: 'Echo', risk: 'read', schema: z.object({ text: z.string().min(1) }),
  title: ({ text }) => `Echo ${text}`, run: async ({ text }) => ok(`Echoed ${text}.`, { text }),
});
const runs: string[] = [];
const dangerTool = defineTool({
  name: 'danger', description: 'Needs a yes', risk: 'confirm', schema: z.object({}),
  title: () => 'Do the risky thing', confirmText: () => 'Really do it?', run: async () => { runs.push('danger'); return ok('Did it.'); },
});
const slowTool = defineTool({
  name: 'slow', description: 'Never finishes', risk: 'act', schema: z.object({}),
  title: () => 'Slow', run: () => new Promise(() => undefined),
});
const TOOLS = [echoTool, dangerTool, slowTool] as unknown as readonly AnyTool[];

const turn = (partial: Partial<AgentTurnResult>): AgentTurnResult => ({ text: '', toolCalls: [], stop: 'end', native: null, model: 'm', ...partial });

function setup(script: readonly (AgentTurnResult | Error)[], options: { confirm?: (c: PendingConfirmation) => Promise<boolean>; toolTimeoutMs?: number } = {}) {
  const requests: AgentTurnRequest[] = [];
  const events: AgentEvent[] = [];
  const confirmations: PendingConfirmation[] = [];
  let index = 0;
  const { ctx } = createFakeContext();
  const toolContext = (signal: AbortSignal): ToolContext => ({ app: ctx, os: null, now: () => new Date(), signal, source: 'voice', remember: () => undefined });
  const input: LoopInput = {
    provider: {
      agentTurn: async (request) => {
        requests.push({ ...request, messages: [...request.messages] });
        const next = script[Math.min(index, script.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return next;
      },
    },
    model: 'm', system: 'sys', history: [], userText: 'hello', contextText: 'It is noon.', toolSpecs: [],
    executor: {
      runId: 'run1', tools: new Map(TOOLS.map((tool) => [tool.name, tool])),
      policyFor: (tool, tainted) => effectivePolicy(tool, {}, tainted),
      emit: (event) => events.push(event),
      confirm: (confirmation) => { confirmations.push(confirmation); return options.confirm?.(confirmation) ?? Promise.resolve(true); },
      toolContext, toolTimeoutMs: options.toolTimeoutMs ?? 1000, newId: () => `c${events.length}`,
    },
    signal: new AbortController().signal, onText: () => undefined,
  };
  return { input, requests, events, confirmations };
}

const toolMessage = (transcript: readonly AgentMessage[]) => transcript.find((message) => message.role === 'tool') as Extract<AgentMessage, { role: 'tool' }>;

describe('runAgentLoop', () => {
  it('runs a tool, returns all results in one tool message, then the final text', async () => {
    const { input, requests, events } = setup([
      turn({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'echo', input: { text: 'a' } }, { id: 't2', name: 'echo', input: { text: 'b' } }] }),
      turn({ text: 'All done.' }),
    ]);

    const result = await runAgentLoop(input);

    expect(result).toMatchObject({ reply: 'All done.', ok: true, stop: 'done' });
    expect(result.actions).toEqual([{ tool: 'echo', title: 'Echo a', ok: true }, { tool: 'echo', title: 'Echo b', ok: true }]);
    expect(toolMessage(result.transcript).results.map((entry) => entry.callId)).toEqual(['t1', 't2']);
    expect(requests[0].messages.slice(0, 2)).toEqual([{ role: 'user', text: 'hello' }, { role: 'context', text: 'It is noon.' }]);
    expect(events.map((event) => event.type)).toEqual(['tool-start', 'tool-end', 'tool-start', 'tool-end']);
  });

  it('asks before a confirm-risk tool and runs it when approved', async () => {
    runs.length = 0;
    const { input, confirmations, events } = setup([turn({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'danger', input: {} }] }), turn({ text: 'Done it.' })]);

    const result = await runAgentLoop(input);

    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({ runId: 'run1', tool: 'danger', title: 'Do the risky thing', summary: 'Really do it?' });
    expect(events[0].type).toBe('tool-confirm');
    expect(runs).toEqual(['danger']);
    expect(result.actions).toEqual([{ tool: 'danger', title: 'Do the risky thing', ok: true }]);
  });

  it('does not run a declined tool and tells the model it was not done', async () => {
    runs.length = 0;
    const { input } = setup([turn({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'danger', input: {} }] }), turn({ text: 'Okay, I left it.' })], { confirm: async () => false });

    const result = await runAgentLoop(input);

    expect(runs).toEqual([]);
    expect(toolMessage(result.transcript).results[0]).toMatchObject({ isError: true });
    expect(toolMessage(result.transcript).results[0].content).toMatch(/said no/);
    expect(result.actions).toEqual([{ tool: 'danger', title: 'Do the risky thing', ok: false }]);
  });

  it('treats a confirmation timeout (resolved false) as a decline', async () => {
    runs.length = 0;
    vi.useFakeTimers();
    const { input } = setup([turn({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'danger', input: {} }] }), turn({ text: 'No answer, so I stopped.' })], {
      confirm: () => new Promise((resolve) => setTimeout(() => resolve(false), 60_000)),
    });

    const pending = runAgentLoop(input);
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;
    vi.useRealTimers();

    expect(runs).toEqual([]);
    expect(result.reply).toBe('No answer, so I stopped.');
  });

  it('returns INVALID_JSON as an error result for input that fails validation', async () => {
    const { input } = setup([turn({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'echo', input: '{"text": ' }] }), turn({ text: 'Sorry.' })]);

    const result = await runAgentLoop(input);
    const entry = toolMessage(result.transcript).results[0];

    expect(entry.isError).toBe(true);
    expect(JSON.parse(entry.content)).toMatchObject({ INVALID_JSON: '{"text": ' });
    expect(result.actions).toEqual([]);
  });

  it('reports unknown tools as errors without crashing', async () => {
    const { input } = setup([turn({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'rm_rf', input: {} }] }), turn({ text: 'I can’t do that.' })]);

    const result = await runAgentLoop(input);

    expect(toolMessage(result.transcript).results[0]).toMatchObject({ isError: true, name: 'rm_rf' });
  });

  it('stops after the maximum number of rounds', async () => {
    const { input, requests } = setup([turn({ text: 'Still going', stop: 'tool_use', toolCalls: [{ id: 't', name: 'echo', input: { text: 'x' } }] })]);

    const result = await runAgentLoop({ ...input, limits: { maxRounds: 3 } });

    expect(requests).toHaveLength(3);
    expect(result).toMatchObject({ stop: 'max-rounds', reply: 'Still going', ok: true });
  });

  it('never runs tools from a turn cut off by max_tokens', async () => {
    runs.length = 0;
    const { input } = setup([turn({ stop: 'max_tokens', toolCalls: [{ id: 't1', name: 'danger', input: {} }] })]);

    const result = await runAgentLoop(input);

    expect(runs).toEqual([]);
    expect(result).toMatchObject({ stop: 'truncated', ok: false });
  });

  it('handles refusals without reading content', async () => {
    const { input } = setup([turn({ stop: 'refusal', text: 'partial' })]);

    expect(await runAgentLoop(input)).toMatchObject({ stop: 'refused', ok: false, reply: 'I can’t help with that one.' });
  });

  it('turns provider errors into their friendly message', async () => {
    const { input } = setup([new LlmError('auth', 'anthropic')]);

    expect(await runAgentLoop(input)).toMatchObject({ stop: 'error', reply: 'Your Claude key was rejected — check it in Settings → AI.' });
  });

  it('stops a tool that runs past its time limit', async () => {
    const { input } = setup([turn({ stop: 'tool_use', toolCalls: [{ id: 't1', name: 'slow', input: {} }] }), turn({ text: 'It was slow.' })], { toolTimeoutMs: 20 });

    const result = await runAgentLoop(input);

    expect(result.actions).toEqual([{ tool: 'slow', title: 'Slow', ok: false }]);
    expect(toolMessage(result.transcript).results[0].content).toMatch(/too long/);
  });

  it('reports a cancel as cancelled', async () => {
    const controller = new AbortController();
    const { input } = setup([turn({ text: 'x' })]);
    controller.abort();

    const result = await runAgentLoop({ ...input, signal: controller.signal, provider: { agentTurn: async () => { throw new LlmError('cancelled', 'anthropic'); } } });

    expect(result).toMatchObject({ stop: 'cancelled', reply: 'Okay, I stopped.' });
  });
});

describe('effectivePolicy', () => {
  it.each([
    ['read', undefined, false, 'run'], ['act', undefined, false, 'run'], ['confirm', undefined, false, 'ask'],
    ['confirm', 'always', false, 'run'], ['read', 'ask', false, 'ask'], ['act', 'never', false, 'block'],
  ] as const)('%s with override %s → %s', (risk, override, tainted, expected) => {
    expect(effectivePolicy({ name: 't', risk }, override ? { t: override } : {}, tainted)).toBe(expected === 'run' && tainted ? 'run' : expected);
  });

  it('asks before an egress tool once untrusted content was read', () => {
    expect(effectivePolicy({ name: 'open_url', risk: 'act', egress: true }, {}, true)).toBe('ask');
    expect(effectivePolicy({ name: 'open_url', risk: 'act', egress: true }, {}, false)).toBe('run');
    expect(effectivePolicy({ name: 'open_url', risk: 'act', egress: true }, { open_url: 'always' }, true)).toBe('run');
  });
});
