/**
 * Provider registry: builds one provider object per id (stateless — keys and base URLs are read
 * on every call) and resolves an LLM role to `{ provider, model }` from settings.
 * Used by the LLM router and by the agent (which needs tool-capable turns).
 */
import type { AppContext } from '../../services';
import { LLM_PROVIDER_IDS, PROVIDERS, type LlmProviderId, type LlmRole, type Settings } from '../../../shared/settings';
import { createAnthropicProvider, type AnthropicClientLike } from './anthropic';
import { LlmError } from './errors';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import type { OpenAiCompatibleId } from './openai-convert';
import type { LlmProvider } from './types';

export interface ResolvedRole {
  readonly provider: LlmProvider;
  readonly providerId: LlmProviderId;
  readonly model: string;
}

export interface ProviderRegistry {
  get(providerId: LlmProviderId): LlmProvider;
  isProviderConfigured(providerId: LlmProviderId): boolean;
  isRoleConfigured(role: LlmRole): boolean;
  /** Throws `LlmError('not-configured')` when the role's provider has no key / address. */
  resolve(role: LlmRole): ResolvedRole;
}

export interface RegistryOverrides {
  readonly fetchImpl?: typeof fetch;
  readonly createAnthropicClient?: (apiKey: string) => AnthropicClientLike;
}

export const isLlmProviderId = (value: string): value is LlmProviderId =>
  (LLM_PROVIDER_IDS as readonly string[]).includes(value);

/** Base URL: user override from settings, else the catalogue default (custom has none). */
export function baseUrlFor(providerId: LlmProviderId, settings: Settings): string | null {
  const override = settings.llm.baseUrls[providerId]?.trim();
  if (override) return override;
  return PROVIDERS.find((info) => info.id === providerId)?.defaultBaseUrl ?? null;
}

type RegistryContext = Pick<AppContext, 'settings' | 'secrets' | 'logger'>;

export function createProviderRegistry(ctx: RegistryContext, overrides: RegistryOverrides = {}): ProviderRegistry {
  const logger = ctx.logger.child('llm');
  const cache = new Map<LlmProviderId, LlmProvider>();
  const key = (providerId: LlmProviderId): string | null => ctx.secrets.get(providerId)?.trim() || null;

  const build = (providerId: LlmProviderId): LlmProvider => {
    if (providerId === 'anthropic') {
      return createAnthropicProvider({ getKey: () => key('anthropic'), logger, createClient: overrides.createAnthropicClient });
    }
    const id: OpenAiCompatibleId = providerId;
    return createOpenAiCompatibleProvider({
      providerId: id,
      logger,
      fetchImpl: overrides.fetchImpl,
      getConfig: () => ({ baseUrl: baseUrlFor(id, ctx.settings.get()), apiKey: key(id) }),
    });
  };

  const get = (providerId: LlmProviderId): LlmProvider => {
    const existing = cache.get(providerId);
    if (existing) return existing;
    const created = build(providerId);
    cache.set(providerId, created);
    return created;
  };

  const isProviderConfigured = (providerId: LlmProviderId): boolean => {
    if (providerId === 'ollama') return baseUrlFor('ollama', ctx.settings.get()) !== null;
    if (providerId === 'custom') return baseUrlFor('custom', ctx.settings.get()) !== null;
    return key(providerId) !== null;
  };

  const roleConfig = (role: LlmRole) => ctx.settings.get().llm.roles[role];

  return {
    get,
    isProviderConfigured,
    isRoleConfigured: (role) => isProviderConfigured(roleConfig(role).providerId),
    resolve(role) {
      const { providerId, model } = roleConfig(role);
      if (!isProviderConfigured(providerId)) throw new LlmError('not-configured', providerId);
      return { provider: get(providerId), providerId, model };
    },
  };
}
