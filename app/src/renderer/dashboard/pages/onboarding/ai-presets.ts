/**
 * The three AI setups offered during onboarding, and the settings patch each one writes.
 * Pure (no React, no IPC) so the mapping is unit-tested.
 */
import {
  DEFAULT_MODEL, LLM_PROVIDER_IDS, LLM_ROLES, PROVIDERS,
  type LlmProviderId, type ProviderInfo, type SecretId, type Settings, type SettingsPatch, type SttProviderId,
} from '@shared/settings';
import type { ProviderTestResult } from '@shared/ipc';

export const AI_PRESETS = ['claude', 'fast', 'private'] as const;
export type AiPreset = (typeof AI_PRESETS)[number];

/** Speech-to-text for the private preset: whisper on this computer, or Groq. */
export const PRIVATE_SPEECH = ['local', 'groq'] as const;
export type PrivateSpeech = (typeof PRIVATE_SPEECH)[number];

export interface AiChoice {
  readonly preset: AiPreset;
  /** Only used by the private preset. */
  readonly speech: PrivateSpeech;
}

export const GROQ_STT_MODEL = 'whisper-large-v3-turbo';
export const LOCAL_STT_MODEL = 'local';

const PRESET_LLM: Readonly<Record<AiPreset, LlmProviderId>> = {
  claude: 'anthropic',
  fast: 'groq',
  private: 'ollama',
};

type Roles = Settings['llm']['roles'];
type ProviderId = LlmProviderId | SttProviderId;

function rolesFor(providerId: LlmProviderId): Roles {
  const entries = LLM_ROLES.map((role) => [role, { providerId, model: DEFAULT_MODEL[providerId] }] as const);
  return Object.fromEntries(entries) as Roles;
}

function sttFor(choice: AiChoice): { readonly providerId: SttProviderId; readonly model: string } {
  if (choice.preset === 'private' && choice.speech === 'local') return { providerId: 'local', model: LOCAL_STT_MODEL };
  return { providerId: 'groq', model: GROQ_STT_MODEL };
}

/** What `settings:update` receives when someone continues with `choice`. */
export function presetPatch(choice: AiChoice): SettingsPatch {
  return { llm: { roles: rolesFor(PRESET_LLM[choice.preset]) }, stt: { ...sttFor(choice) } };
}

/** The preset matching saved settings, so returning to this step shows what is already set up. */
export function choiceFromSettings(settings: Settings): AiChoice {
  const providers = new Set(LLM_ROLES.map((role) => settings.llm.roles[role].providerId));
  const only = providers.size === 1 ? [...providers][0] : null;
  const speech: PrivateSpeech = only === 'ollama' && settings.stt.providerId === 'groq' ? 'groq' : 'local';
  if (only === 'groq') return { preset: 'fast', speech };
  if (only === 'ollama') return { preset: 'private', speech };
  return { preset: 'claude', speech };
}

/** One provider the chosen setup depends on, with what it is used for. */
export interface ProviderNeed {
  readonly providerId: ProviderId;
  readonly purpose: string;
  /** Which capability the "Test" button checks. */
  readonly testKind: 'llm' | 'stt';
  readonly info: ProviderInfo;
}

function need(providerId: ProviderId, testKind: 'llm' | 'stt', purpose: string): ProviderNeed {
  const info = PROVIDERS.find((p) => p.id === providerId);
  if (!info) throw new Error(`Unknown provider: ${providerId}`);
  return { providerId, testKind, purpose, info };
}

/** Providers to connect for `choice`, thinking first, then speech. */
export function providersFor(choice: AiChoice): readonly ProviderNeed[] {
  switch (choice.preset) {
    case 'claude':
      return [
        need('anthropic', 'llm', 'Thinks: answers, chat and Leafy’s tasks.'),
        need('groq', 'stt', 'Turns your speech into text, quickly.'),
      ];
    case 'fast':
      return [need('groq', 'llm', 'Thinks and turns your speech into text.')];
    case 'private':
      return [
        need('ollama', 'llm', 'Thinks, on this computer.'),
        choice.speech === 'local'
          ? need('local', 'stt', 'Turns your speech into text, on this computer.')
          : need('groq', 'stt', 'Turns your speech into text, quickly.'),
      ];
  }
}

const isLlmProvider = (id: ProviderId): id is LlmProviderId => (LLM_PROVIDER_IDS as readonly string[]).includes(id);

/** The secret slot for a provider's key, or null when it needs no key. */
export function secretIdFor(item: ProviderNeed): SecretId | null {
  return item.info.needsKey && isLlmProvider(item.providerId) ? item.providerId : null;
}

/** "Connected · 412 ms", or the provider's own plain-language error. */
export function formatTestResult(result: ProviderTestResult): string {
  if (!result.ok) return result.message;
  return result.latencyMs === null ? 'Connected' : `Connected · ${result.latencyMs} ms`;
}
