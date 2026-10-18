import { describe, expect, it, vi } from 'vitest';
import { createLlmRouter, ROLE_EFFORT, ROLE_MAX_TOKENS } from '../../../src/main/ai/llm/router';
import { baseUrlFor } from '../../../src/main/ai/llm/registry';
import type { AnthropicClientLike } from '../../../src/main/ai/llm/anthropic';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings';
import { createFakeContext } from '../agent/fake-context';

function anthropicClient(text = 'OK') {
  const bodies: unknown[] = [];
  const client = (): AnthropicClientLike => ({
    create: async (body) => {
      bodies.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text, citations: null }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as never;
    },
    stream: () => { throw new Error('not used'); },
  });
  return { client, bodies };
}

describe('createLlmRouter', () => {
  it('uses low effort for polish/answer/extract and medium for agent/chat', () => {
    expect(ROLE_EFFORT).toEqual({ polish: 'low', answer: 'low', extract: 'low', agent: 'medium', chat: 'medium' });
    expect(ROLE_MAX_TOKENS.polish).toBe(2000);
    expect(ROLE_MAX_TOKENS.agent).toBe(16_000);
  });

  it('routes a role to its provider and model', async () => {
    const { ctx } = createFakeContext();
    const fake = anthropicClient('Polished.');
    const router = createLlmRouter(ctx, { createAnthropicClient: fake.client });

    const result = await router.complete('polish', { system: 'S', messages: [{ role: 'user', content: 'x' }] });

    expect(result).toMatchObject({ text: 'Polished.', providerId: 'anthropic', model: 'claude-opus-5-5' });
    expect(fake.bodies[0]).toMatchObject({ output_config: { effort: 'low' }, max_tokens: 2000 });
  });

  it('reports configuration from key presence (Ollama needs none)', () => {
    const { ctx } = createFakeContext({
      settings: { llm: { roles: { ...DEFAULT_SETTINGS.llm.roles, chat: { providerId: 'ollama', model: 'qwen3:8b' } } } },
      services: { secrets: { get: () => null } },
    });
    const router = createLlmRouter(ctx);
    expect(router.isConfigured('polish')).toBe(false);
    expect(router.isConfigured('chat')).toBe(true);
  });

  it('throws a friendly not-configured error', async () => {
    const { ctx } = createFakeContext({ services: { secrets: { get: () => null } } });
    await expect(createLlmRouter(ctx).complete('answer', { system: 's', messages: [] })).rejects.toMatchObject({
      code: 'not-configured', message: 'Add a Claude key in Settings → AI to use this.',
    });
  });

  it('tests a provider and reports latency', async () => {
    const { ctx } = createFakeContext();
    const result = await createLlmRouter(ctx, { createAnthropicClient: anthropicClient().client }).test('anthropic');
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(result.message).toMatch(/^Connected to Claude \(claude-opus-5-5\)/);
  });

  it('reports test failures in plain words', async () => {
    const { ctx } = createFakeContext();
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const router = createLlmRouter(ctx, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await router.test('groq')).toEqual({ ok: false, latencyMs: null, message: 'Your Groq key was rejected — check it in Settings → AI.' });
    expect((await router.test('nonsense')).ok).toBe(false);
  });

  it('resolves base URLs from overrides, then the catalogue', () => {
    expect(baseUrlFor('groq', DEFAULT_SETTINGS)).toBe('https://api.groq.com/openai/v1');
    expect(baseUrlFor('custom', DEFAULT_SETTINGS)).toBeNull();
    expect(baseUrlFor('ollama', { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, baseUrls: { ollama: 'http://box:11434/v1' } } })).toBe('http://box:11434/v1');
  });
});
