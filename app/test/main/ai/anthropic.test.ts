import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageStreamParams, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider, mapAnthropicError, type AnthropicClientLike } from '../../../src/main/ai/llm/anthropic';
import { FALLBACK_BETA, sanitizeForReplay, toAnthropicMessages } from '../../../src/main/ai/llm/anthropic-convert';
import { LlmError } from '../../../src/main/ai/llm/errors';
import type { AgentMessage } from '../../../src/main/ai/llm/types';
import { silentLogger } from '../agent/fake-context';

const message = (partial: Partial<BetaMessage>): BetaMessage => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'end_turn',
  stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  ...partial,
} as BetaMessage);

function fakeClient(responses: readonly (BetaMessage | Error)[]) {
  const created: MessageCreateParamsNonStreaming[] = [];
  const streamed: BetaMessageStreamParams[] = [];
  const keys: string[] = [];
  let index = 0;
  const next = async () => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (response instanceof Error) throw response;
    return response;
  };
  const factory = (apiKey: string): AnthropicClientLike => {
    keys.push(apiKey);
    return {
      create: async (body) => { created.push(body); return next(); },
      stream: (body) => {
        streamed.push(body);
        let listener: (delta: string) => void = () => undefined;
        return {
          on: (_event, callback) => { listener = callback; },
          finalMessage: async () => {
            const result = await next();
            result.content.filter((block) => block.type === 'text').forEach((block) => listener((block as { text: string }).text));
            return result;
          },
        };
      },
    };
  };
  return { factory, created, streamed, keys };
}

const provider = (client: ReturnType<typeof fakeClient>, key: string | null = 'sk-test') =>
  createAnthropicProvider({ getKey: () => key, logger: silentLogger(), createClient: client.factory });

const request = { model: 'claude-opus-5-5', system: 'Be helpful.', messages: [{ role: 'user' as const, content: 'Hi' }], maxTokens: 2000, json: false, effort: 'low' as const };

describe('Anthropic provider — request shaping', () => {
  it('caches the system prompt, sets effort, omits thinking and enables the default fallback', async () => {
    const client = fakeClient([message({ content: [{ type: 'text', text: 'Hello!', citations: null }] as BetaMessage['content'] })]);

    const result = await provider(client).complete(request);

    expect(result).toEqual({ text: 'Hello!', model: 'claude-opus-5-5' });
    expect(client.keys).toEqual(['sk-test']);
    expect(client.created[0]).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 2000, stream: false,
      system: [{ type: 'text', text: 'Be helpful.', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' }, betas: [FALLBACK_BETA], fallbacks: 'default',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(client.created[0]).not.toHaveProperty('thinking');
    expect(client.created[0]).not.toHaveProperty('tool_choice');
  });

  it('does not request fallbacks for Haiku', async () => {
    const client = fakeClient([message({ model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'ok', citations: null }] as BetaMessage['content'] })]);
    await provider(client).complete({ ...request, model: 'claude-haiku-5-5' });
    expect(client.created[0]).not.toHaveProperty('fallbacks');
    expect(client.created[0]).not.toHaveProperty('betas');
  });

  it('asks for JSON in the system prompt and strips code fences', async () => {
    const client = fakeClient([message({ content: [{ type: 'text', text: '```json\n{"a":1}\n```', citations: null }] as BetaMessage['content'] })]);
    const result = await provider(client).complete({ ...request, json: true });
    expect(result.text).toBe('{"a":1}');
    expect((client.created[0].system as { text: string }[])[0].text).toContain('exactly one JSON object');
  });

  it('checks for refusals before reading content', async () => {
    const client = fakeClient([message({ stop_reason: 'refusal', content: [{ type: 'text', text: 'partial', citations: null }] as BetaMessage['content'] })]);
    await expect(provider(client).complete(request)).rejects.toMatchObject({ code: 'refused' });
  });

  it('streams text deltas and resolves with the final message', async () => {
    const client = fakeClient([message({ content: [{ type: 'text', text: 'Streamed.', citations: null }] as BetaMessage['content'] })]);
    const deltas: string[] = [];
    const result = await provider(client).stream(request, (delta) => deltas.push(delta));
    expect(deltas).toEqual(['Streamed.']);
    expect(result.text).toBe('Streamed.');
  });

  it('refuses to call without a key', async () => {
    await expect(provider(fakeClient([]), null).complete(request)).rejects.toMatchObject({ code: 'not-configured' });
  });
});

describe('Anthropic provider — agent turns', () => {
  const tools = [{ name: 'open_app', description: 'Open an app', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } }];
  const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
  const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'open_app', input: { name: 'Calendar' } };

  it('sends strict, eagerly streamed tools with auto tool choice and replays native content unchanged', async () => {
    const first = message({ stop_reason: 'tool_use', content: [thinking, toolUse] as BetaMessage['content'] });
    const client = fakeClient([first]);
    const history: AgentMessage[] = [
      { role: 'user', text: 'open calendar' },
      { role: 'context', text: 'It is 2 PM.' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'toolu_0', name: 'open_app', input: {} }], native: { providerId: 'anthropic', model: 'claude-opus-5-5', content: [thinking, toolUse] } },
      { role: 'tool', results: [{ callId: 'toolu_0', name: 'open_app', content: '{"ok":true}', isError: false }, { callId: 'toolu_x', name: 'open_app', content: 'bad', isError: true }] },
    ];

    const turn = await provider(client).agentTurn({ model: 'claude-opus-5-5', system: 'sys', messages: history, tools, maxTokens: 16000, effort: 'medium' }, () => undefined);

    const body = client.streamed[0];
    expect(body.tools).toEqual([{ name: 'open_app', description: 'Open an app', input_schema: tools[0].inputSchema, strict: true, eager_input_streaming: true }]);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.max_tokens).toBe(16000);
    expect(body.messages).toEqual([
      { role: 'user', content: 'open calendar' },
      { role: 'system', content: 'It is 2 PM.' },
      { role: 'assistant', content: [thinking, toolUse] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: '{"ok":true}' }, { type: 'tool_result', tool_use_id: 'toolu_x', content: 'bad', is_error: true }] },
    ]);
    expect(turn).toMatchObject({ stop: 'tool_use', toolCalls: [{ id: 'toolu_1', name: 'open_app', input: { name: 'Calendar' } }], native: { providerId: 'anthropic', content: [thinking, toolUse] } });
  });

  it('re-issues a turn whose streamed tool input could not be parsed, but never on API errors', async () => {
    const client = fakeClient([new SyntaxError('Unexpected end of JSON'), message({ content: [{ type: 'text', text: 'ok', citations: null }] as BetaMessage['content'] })]);
    const turn = await provider(client).agentTurn({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', text: 'x' }], tools, maxTokens: 100, effort: 'medium' }, () => undefined);
    expect(client.streamed).toHaveLength(2);
    expect(turn.text).toBe('ok');
  });

  it('does not re-issue (and so never repeats text) once text has been streamed', async () => {
    const emitted: string[] = [];
    const factory = (): AnthropicClientLike => ({
      create: async () => { throw new Error('unused'); },
      stream: () => {
        let listener: (delta: string) => void = () => undefined;
        return {
          on: (_event, callback) => { listener = callback; },
          finalMessage: async () => { listener('Let me check'); throw new SyntaxError('Unexpected end of JSON'); },
        };
      },
    });
    const anthropic = createAnthropicProvider({ getKey: () => 'k', logger: silentLogger(), createClient: factory });
    await expect(anthropic.agentTurn({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', text: 'x' }], tools, maxTokens: 100, effort: 'medium' }, (delta) => emitted.push(delta)))
      .rejects.toMatchObject({ code: 'invalid-output' });
    expect(emitted).toEqual(['Let me check']);
  });

  it('returns refusal turns without tool calls', async () => {
    const client = fakeClient([message({ stop_reason: 'refusal', content: [toolUse] as BetaMessage['content'] })]);
    const turn = await provider(client).agentTurn({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', text: 'x' }], tools, maxTokens: 100, effort: 'medium' }, () => undefined);
    expect(turn).toMatchObject({ stop: 'refusal', toolCalls: [] });
  });

  it('turns the context into a user block for models without mid-conversation system messages', () => {
    expect(toAnthropicMessages([{ role: 'context', text: 'ctx' }], 'claude-sonnet-5')).toEqual([{ role: 'user', content: '<context>\nctx\n</context>' }]);
  });

  it('drops pre-fallback thinking and tool_use blocks before replay', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'part ' }, { type: 'tool_use', id: 'a', name: 'x', input: {} },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }, { type: 'text', text: 'rest' }, { type: 'tool_use', id: 'b', name: 'x', input: {} },
    ] as unknown as BetaMessage['content'];
    expect(sanitizeForReplay(content).map((block) => block.type)).toEqual(['text', 'fallback', 'text', 'tool_use']);
  });
});

describe('mapAnthropicError', () => {
  const headers = new Headers();
  it.each([
    [new Anthropic.AuthenticationError(401, undefined, 'bad key', headers), 'auth', 'Your Claude key was rejected — check it in Settings → AI.'],
    [new Anthropic.RateLimitError(429, undefined, 'slow down', headers), 'rate-limit', 'Claude is busy right now. Wait a moment and try again.'],
    [new Anthropic.APIConnectionTimeoutError({ message: 'timeout' }), 'timeout', 'Claude took too long to answer. Try again in a moment.'],
    [new Anthropic.APIConnectionError({ message: 'offline' }), 'connection', 'Couldn’t reach Claude. Check your internet connection and try again.'],
    [new Anthropic.BadRequestError(400, undefined, 'bad', headers), 'bad-request', 'Claude couldn’t handle that request. Check the model name in Settings → AI.'],
    [new Anthropic.InternalServerError(529, undefined, 'overloaded', headers), 'server', 'Claude had a problem on its side. Try again in a moment.'],
  ])('maps %s to %s', (error, code, message) => {
    expect(mapAnthropicError(error)).toMatchObject({ code, message });
  });

  it('distinguishes a user cancel from a timeout', () => {
    const controller = new AbortController();
    controller.abort();
    expect(mapAnthropicError(new Anthropic.APIUserAbortError(), controller.signal).code).toBe('cancelled');
    expect(mapAnthropicError(new Anthropic.APIUserAbortError()).code).toBe('timeout');
    expect(mapAnthropicError(new LlmError('empty', 'anthropic')).code).toBe('empty');
  });

  it('wraps SDK errors raised by the client', async () => {
    const client = fakeClient([new Anthropic.AuthenticationError(401, undefined, 'bad', headers)]);
    const call = vi.fn(() => provider(client).complete(request));
    await expect(call()).rejects.toBeInstanceOf(LlmError);
  });
});
