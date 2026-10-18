/**
 * Typed, user-friendly errors for every LLM provider. Messages are plain sentences that say what
 * happened and what to do; the technical cause is kept on `cause` for logs only.
 */
import type { LlmProviderId } from '../../../shared/settings';

export type LlmErrorCode =
  | 'not-configured'
  | 'auth'
  | 'rate-limit'
  | 'connection'
  | 'timeout'
  | 'cancelled'
  | 'refused'
  | 'bad-request'
  | 'server'
  | 'empty'
  | 'invalid-output';

export const PROVIDER_NAMES: Readonly<Record<LlmProviderId, string>> = {
  anthropic: 'Claude',
  groq: 'Groq',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  custom: 'your custom AI server',
};

export function providerName(providerId: string): string {
  return (PROVIDER_NAMES as Record<string, string>)[providerId] ?? providerId;
}

const MESSAGES: Readonly<Record<LlmErrorCode, (name: string, providerId: string) => string>> = {
  'not-configured': (name, id) =>
    id === 'custom' ? 'Add your custom AI server address and key in Settings → AI.' : `Add a ${name} key in Settings → AI to use this.`,
  auth: (name) => `Your ${name} key was rejected — check it in Settings → AI.`,
  'rate-limit': (name) => `${name} is busy right now. Wait a moment and try again.`,
  connection: (name, id) =>
    id === 'ollama'
      ? 'Couldn’t reach Ollama on this computer — make sure it is open, then try again.'
      : `Couldn’t reach ${name}. Check your internet connection and try again.`,
  timeout: (name) => `${name} took too long to answer. Try again in a moment.`,
  cancelled: () => 'Stopped.',
  refused: (name) => `${name} declined to help with that request.`,
  'bad-request': (name) => `${name} couldn’t handle that request. Check the model name in Settings → AI.`,
  server: (name) => `${name} had a problem on its side. Try again in a moment.`,
  empty: (name) => `${name} sent back an empty answer. Try again.`,
  'invalid-output': (name) => `${name} sent back something Rivertide couldn’t use. Try again.`,
};

export function friendlyLlmMessage(code: LlmErrorCode, providerId: string): string {
  return MESSAGES[code](providerName(providerId), providerId);
}

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly providerId: string;

  constructor(code: LlmErrorCode, providerId: string, options?: { readonly cause?: unknown; readonly message?: string }) {
    super(options?.message ?? friendlyLlmMessage(code, providerId), { cause: options?.cause });
    this.name = 'LlmError';
    this.code = code;
    this.providerId = providerId;
  }
}

export const isLlmError = (error: unknown): error is LlmError => error instanceof LlmError;

/** Maps an HTTP status from an OpenAI-compatible server to an error code. */
export function codeForStatus(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'bad-request';
}

/** Distinguishes a user cancel from our own timeout when a fetch/SDK call aborts. */
export function abortCode(signal: AbortSignal | undefined): LlmErrorCode {
  return signal?.aborted ? 'cancelled' : 'timeout';
}

/** Short technical description for logs (never shown to users). */
export function describeCause(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error).slice(0, 300);
}
