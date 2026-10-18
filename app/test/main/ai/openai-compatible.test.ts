import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleProvider, type EndpointConfig } from '../../../src/main/ai/llm/openai-compatible';
import { chatBody, mapFinishReason, parseToolArguments, toOaMessages } from '../../../src/main/ai/llm/openai-convert';
import { accumulateChatStream, parseSse } from '../../../src/main/ai/llm/sse';
import type { AgentMessage } from '../../../src/main/ai/llm/types';
import { silentLogger } from '../agent/fake-context';

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const part of parts) yield encoder.encode(part);
}
const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
};
const sse = (...events: unknown[]) => [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('');

describe('parseSse', () => {
  it('splits events across arbitrary chunk boundaries and stops at [DONE]', async () => {
    const payloads = await collect(parseSse(chunks('data: {"a"', ':1}\n\ndata: {"b":2}\r\n\r\n: keep-alive\n\ndata: [DO', 'NE]\n\ndata: {"c":3}\n\n')));
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins multi-line data and flushes a trailing event without a blank line', async () => {
    expect(await collect(parseSse(chunks('data: line1\ndata: line2\n\ndata: tail')))).toEqual(['line1\nline2', 'tail']);
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: "café ☕"\n\n');
    async function* split() { yield bytes.slice(0, 11); yield bytes.slice(11); }
    expect(await collect(parseSse(split()))).toEqual(['"café ☕"']);
  });
});

describe('accumulateChatStream', () => {
  it('folds text deltas and fragmented tool calls by index', async () => {
    const deltas: string[] = [];
    const body = sse(
      { model: 'gpt-5-mini', choices: [{ delta: { content: 'Let me ' } }] },
      { choices: [{ delta: { content: 'check.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'open_app', arguments: '{"na' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'me":"Notes"}' } }, { index: 1, id: 'call_2', function: { name: 'set_timer', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    );

    const result = await accumulateChatStream(parseSse(chunks(body)), (delta) => deltas.push(delta));

    expect(deltas.join('')).toBe('Let me check.');
    expect(result).toEqual({
      text: 'Let me check.', finishReason: 'tool_calls', model: 'gpt-5-mini',
      toolCalls: [{ id: 'call_1', name: 'open_app', arguments: '{"name":"Notes"}' }, { id: 'call_2', name: 'set_timer', arguments: '{}' }],
    });
  });

  it('surfaces in-stream errors', async () => {
    await expect(accumulateChatStream(parseSse(chunks(sse({ error: { message: 'overloaded' } }))), () => undefined)).rejects.toThrow('overloaded');
  });
});

describe('openai-convert', () => {
  it('builds bodies per provider (token key, JSON mode, reasoning effort)', () => {
    const base = { model: 'gpt-5-mini', system: 'S', maxTokens: 100, effort: 'low' as const, json: true, stream: false };
    expect(chatBody({ ...base, providerId: 'openai' }, [])).toEqual({
      model: 'gpt-5-mini', messages: [{ role: 'system', content: expect.stringContaining('exactly one JSON object') }],
      max_completion_tokens: 100, response_format: { type: 'json_object' }, reasoning_effort: 'low',
    });
    expect(chatBody({ ...base, providerId: 'ollama', model: 'qwen3:8b', json: false, stream: true }, [])).toEqual({
      model: 'qwen3:8b', messages: [{ role: 'system', content: 'S' }], max_tokens: 100, stream: true,
    });
  });

  it('converts the neutral transcript, one tool message per result', () => {
    const transcript: AgentMessage[] = [
      { role: 'user', text: 'hi' }, { role: 'context', text: 'ctx' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'open_app', input: { name: 'Notes' } }], native: null },
      { role: 'tool', results: [{ callId: 'c1', name: 'open_app', content: 'done', isError: false }, { callId: 'c2', name: 'x', content: 'nope', isError: true }] },
    ];
    expect(toOaMessages(transcript, 'groq')).toEqual([
      { role: 'user', content: 'hi' }, { role: 'system', content: 'ctx' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'open_app', arguments: '{"name":"Notes"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'done' }, { role: 'tool', tool_call_id: 'c2', content: 'ERROR: nope' },
    ]);
  });

  it('maps finish reasons and keeps unparseable arguments as raw text', () => {
    expect(mapFinishReason('stop', true)).toBe('tool_use');
    expect(mapFinishReason('length', false)).toBe('max_tokens');
    expect(mapFinishReason('content_filter', false)).toBe('refusal');
    expect(parseToolArguments('{"a":')).toBe('{"a":');
    expect(parseToolArguments('')).toEqual({});
  });
});

describe('OpenAI-compatible provider', () => {
  const config: EndpointConfig = { baseUrl: 'https://api.groq.com/openai/v1/', apiKey: 'gsk' };
  const make = (fetchImpl: typeof fetch, endpoint: EndpointConfig = config, providerId: 'groq' | 'ollama' | 'openrouter' = 'groq') =>
    createOpenAiCompatibleProvider({ providerId, getConfig: () => endpoint, logger: silentLogger(), fetchImpl });
  const request = { model: 'openai/gpt-oss-120b', system: 'S', messages: [{ role: 'user' as const, content: 'Hi' }], maxTokens: 50, json: false, effort: 'low' as const };

  it('posts to /chat/completions with a bearer key and parses the reply', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ model: 'openai/gpt-oss-120b', choices: [{ message: { content: ' Hello ' }, finish_reason: 'stop' }] })));
    const result = await make(fetchImpl as unknown as typeof fetch).complete(request);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk');
    expect(JSON.parse(init.body as string)).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 50 });
    expect(result).toEqual({ text: 'Hello', model: 'openai/gpt-oss-120b' });
  });

  it('needs no key for Ollama', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    await make(fetchImpl as unknown as typeof fetch, { baseUrl: 'http://localhost:11434/v1', apiKey: null }, 'ollama').complete(request);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('authorization');
  });

  it.each([[401, 'auth'], [429, 'rate-limit'], [500, 'server'], [404, 'bad-request']])('maps HTTP %i to %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status }));
    await expect(make(fetchImpl as unknown as typeof fetch).complete(request)).rejects.toMatchObject({ code });
  });

  it('reports network failures as connection errors and missing keys as not configured', async () => {
    const offline = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(make(offline as unknown as typeof fetch).complete(request)).rejects.toMatchObject({ code: 'connection' });
    await expect(make(offline as unknown as typeof fetch, { baseUrl: config.baseUrl, apiKey: null }).complete(request)).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('streams an agent turn with tools', async () => {
    const body = sse(
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'open_app', arguments: '{"name":"Notes"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    );
    const fetchImpl = vi.fn(async () => new Response(body));
    const turn = await make(fetchImpl as unknown as typeof fetch).agentTurn({
      model: 'm', system: 'S', messages: [{ role: 'user', text: 'open notes' }], maxTokens: 100, effort: 'medium',
      tools: [{ name: 'open_app', description: 'Open', inputSchema: { type: 'object', properties: {} } }],
    }, () => undefined);
    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toMatchObject({ stream: true, tool_choice: 'auto', tools: [{ type: 'function', function: { name: 'open_app' } }] });
    expect(turn).toMatchObject({ stop: 'tool_use', toolCalls: [{ id: 'call_9', name: 'open_app', input: { name: 'Notes' } }], native: { providerId: 'groq' } });
  });
});
