/**
 * `createLlmRouter(ctx)` — the LlmRouter service. Resolves `settings.llm.roles[role]` to a provider,
 * applies per-role effort and token budgets, logs metadata (never prompt text at info level), and
 * offers `test(providerId)` for the Settings → AI "Test" button.
 */
import type { AppContext, CompletionRequest, CompletionResult, LlmRouter } from '../../services';
import type { ProviderTestResult } from '../../../shared/ipc';
import { DEFAULT_MODEL, LLM_ROLES, type LlmProviderId, type LlmRole } from '../../../shared/settings';
import { describeCause, isLlmError, LlmError, providerName } from './errors';
import { createProviderRegistry, isLlmProviderId, type ProviderRegistry, type RegistryOverrides } from './registry';
import type { Effort, ProviderRequest } from './types';

export const ROLE_EFFORT: Readonly<Record<LlmRole, Effort>> = {
  polish: 'low', answer: 'low', extract: 'low', agent: 'medium', chat: 'medium',
};
export const ROLE_MAX_TOKENS: Readonly<Record<LlmRole, number>> = {
  polish: 2000, answer: 2000, extract: 2000, agent: 16_000, chat: 16_000,
};
const TEST_MAX_TOKENS = 1024;
const DEBUG_PREVIEW_CHARS = 160;

const preview = (text: string): string => (text.length > DEBUG_PREVIEW_CHARS ? `${text.slice(0, DEBUG_PREVIEW_CHARS)}…` : text);

export function createLlmRouter(ctx: AppContext, overrides: RegistryOverrides = {}): LlmRouter {
  const log = ctx.logger.child('llm-router');
  let registry: ProviderRegistry | null = null;
  // Built lazily: factories may only store ctx while the context is being assembled.
  const providers = (): ProviderRegistry => (registry ??= createProviderRegistry(ctx, overrides));

  function prepare(role: LlmRole, request: CompletionRequest) {
    const resolved = providers().resolve(role);
    const providerRequest: ProviderRequest = {
      model: resolved.model,
      system: request.system,
      messages: request.messages,
      maxTokens: request.maxTokens ?? ROLE_MAX_TOKENS[role],
      json: request.json ?? false,
      effort: ROLE_EFFORT[role],
      signal: request.signal,
    };
    // Prompts may contain the user's health information: debug level only, truncated.
    log.debug('llm request', { role, system: preview(request.system), last: preview(request.messages.at(-1)?.content ?? '') });
    return { resolved, providerRequest };
  }

  async function run(role: LlmRole, request: CompletionRequest, onDelta: ((delta: string) => void) | null): Promise<CompletionResult> {
    const { resolved, providerRequest } = prepare(role, request);
    const startedAt = Date.now();
    try {
      const result = onDelta
        ? await resolved.provider.stream(providerRequest, onDelta)
        : await resolved.provider.complete(providerRequest);
      const latencyMs = Date.now() - startedAt;
      log.info('llm completed', { role, providerId: resolved.providerId, model: result.model, latencyMs, chars: result.text.length });
      return { text: result.text, providerId: resolved.providerId, model: result.model, latencyMs };
    } catch (error) {
      const code = isLlmError(error) ? error.code : 'unknown';
      if (code !== 'cancelled') log.warn('llm failed', { role, providerId: resolved.providerId, code, cause: describeCause(error) });
      throw error;
    }
  }

  async function test(providerId: string): Promise<ProviderTestResult> {
    if (!isLlmProviderId(providerId)) return { ok: false, latencyMs: null, message: 'That AI service isn’t one Rivertide knows.' };
    if (!providers().isProviderConfigured(providerId)) {
      return { ok: false, latencyMs: null, message: new LlmError('not-configured', providerId).message };
    }
    const model = modelFor(providerId);
    const startedAt = Date.now();
    try {
      await providers().get(providerId).complete({
        model, system: 'You are a connection test. Reply with the single word: OK', messages: [{ role: 'user', content: 'Test' }],
        maxTokens: TEST_MAX_TOKENS, json: false, effort: 'low',
      });
      return success(providerId, model, Date.now() - startedAt);
    } catch (error) {
      // An empty reply still proves the key and connection work.
      if (isLlmError(error) && error.code === 'empty') return success(providerId, model, Date.now() - startedAt);
      log.warn('provider test failed', { providerId, cause: describeCause(error) });
      return { ok: false, latencyMs: null, message: isLlmError(error) ? error.message : 'The test failed. Try again in a moment.' };
    }
  }

  function modelFor(providerId: LlmProviderId): string {
    const roles = ctx.settings.get().llm.roles;
    const role = LLM_ROLES.find((name) => roles[name].providerId === providerId);
    return role ? roles[role].model : DEFAULT_MODEL[providerId];
  }

  const success = (providerId: LlmProviderId, model: string, latencyMs: number): ProviderTestResult => ({
    ok: true, latencyMs, message: `Connected to ${providerName(providerId)} (${model}) in ${latencyMs} ms.`,
  });

  return {
    isConfigured: (role) => providers().isRoleConfigured(role),
    complete: (role, request) => run(role, request, null),
    stream: (role, request, onDelta) => run(role, request, onDelta),
    test,
  };
}
