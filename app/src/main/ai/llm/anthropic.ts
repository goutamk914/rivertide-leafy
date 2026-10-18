/**
 * Claude provider — uses ONLY the official `@anthropic-ai/sdk`.
 *
 * - A client is created per call (keys can change in Settings at any time).
 * - Beta Messages API so the server-side refusal fallback (`fallbacks: "default"`) can be enabled.
 * - Agent turns stream with `eager_input_streaming` tools; inputs are validated by the loop.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageStreamParams,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Logger } from '../../services';
import { abortCode, describeCause, LlmError } from './errors';
import {
  baseRequest, parseAgentTurn, textOf, toAnthropicMessages, toAnthropicTools, toSimpleMessages,
} from './anthropic-convert';
import type { AgentTurnRequest, AgentTurnResult, LlmProvider, ProviderCompletion, ProviderRequest } from './types';
import { stripCodeFence } from './types';

const CLIENT_TIMEOUT_MS = 30_000;
const CLIENT_MAX_RETRIES = 2;
/** Re-issue a turn whose streamed tool input could not be parsed at all (never on API errors). */
const MAX_UNPARSEABLE_RETRIES = 2;

export interface AnthropicStreamLike {
  on(event: 'text', listener: (delta: string) => void): unknown;
  finalMessage(): Promise<BetaMessage>;
}

/** The two SDK calls we use, narrowed so tests can inject a fake (no network). */
export interface AnthropicClientLike {
  create(body: MessageCreateParamsNonStreaming, options: { readonly signal?: AbortSignal }): Promise<BetaMessage>;
  stream(body: BetaMessageStreamParams, options: { readonly signal?: AbortSignal }): AnthropicStreamLike;
}

export function createSdkClient(apiKey: string): AnthropicClientLike {
  const client = new Anthropic({ apiKey, timeout: CLIENT_TIMEOUT_MS, maxRetries: CLIENT_MAX_RETRIES });
  return {
    create: (body, options) => client.beta.messages.create(body, options),
    stream: (body, options) => client.beta.messages.stream(body, options),
  };
}

export interface AnthropicProviderDeps {
  readonly getKey: () => string | null;
  readonly logger: Logger;
  readonly createClient?: (apiKey: string) => AnthropicClientLike;
}

/** Typed SDK errors → friendly LlmError, most specific first. */
export function mapAnthropicError(error: unknown, signal?: AbortSignal): LlmError {
  const make = (code: ConstructorParameters<typeof LlmError>[0]) => new LlmError(code, 'anthropic', { cause: error });
  if (error instanceof LlmError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return make(abortCode(signal));
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return make('auth');
  if (error instanceof Anthropic.RateLimitError) return make('rate-limit');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return make('timeout');
  if (error instanceof Anthropic.APIConnectionError) return make('connection');
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return make('bad-request');
  if (error instanceof Anthropic.UnprocessableEntityError) return make('bad-request');
  if (error instanceof Anthropic.APIError) return make((error.status ?? 500) >= 500 ? 'server' : 'bad-request');
  if (error instanceof Error && error.name === 'AbortError') return make(abortCode(signal));
  return make('server');
}

function readCompletion(message: BetaMessage, json: boolean): ProviderCompletion {
  if (message.stop_reason === 'refusal') throw new LlmError('refused', 'anthropic');
  const text = textOf(message.content).trim();
  if (!text) throw new LlmError('empty', 'anthropic');
  return { text: json ? stripCodeFence(text) : text, model: message.model };
}

export function createAnthropicProvider(deps: AnthropicProviderDeps): LlmProvider {
  const log = deps.logger.child('anthropic');
  const makeClient = deps.createClient ?? createSdkClient;

  const client = (): AnthropicClientLike => {
    const key = deps.getKey();
    if (!key) throw new LlmError('not-configured', 'anthropic');
    return makeClient(key);
  };

  const guarded = async <T>(signal: AbortSignal | undefined, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      const mapped = mapAnthropicError(error, signal);
      if (mapped.code !== 'cancelled') log.warn('request failed', { code: mapped.code, cause: describeCause(error) });
      throw mapped;
    }
  };

  const simpleBody = (request: ProviderRequest): MessageCreateParamsNonStreaming => ({
    ...baseRequest(request),
    messages: toSimpleMessages(request.messages),
    stream: false,
  });

  async function complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const api = client();
    const message = await guarded(request.signal, () => api.create(simpleBody(request), { signal: request.signal }));
    return readCompletion(message, request.json);
  }

  async function stream(request: ProviderRequest, onDelta: (delta: string) => void): Promise<ProviderCompletion> {
    const api = client();
    const message = await guarded(request.signal, () => {
      const live = api.stream(simpleBody(request), { signal: request.signal });
      live.on('text', onDelta);
      return live.finalMessage();
    });
    return readCompletion(message, request.json);
  }

  async function streamTurn(api: AnthropicClientLike, body: BetaMessageStreamParams, request: AgentTurnRequest, onDelta: (delta: string) => void): Promise<BetaMessage> {
    for (let attempt = 0; ; attempt += 1) {
      let emitted = false;
      try {
        const live = api.stream(body, { signal: request.signal });
        live.on('text', (delta) => {
          emitted = true;
          onDelta(delta);
        });
        return await live.finalMessage();
      } catch (error) {
        const isApiError = error instanceof Anthropic.APIError || error instanceof LlmError;
        if (isApiError || request.signal?.aborted) throw error;
        // Text already reached the listener: a retry would repeat it, so fail this turn instead.
        if (emitted || attempt >= MAX_UNPARSEABLE_RETRIES) throw new LlmError('invalid-output', 'anthropic', { cause: error });
        log.warn('streamed tool input was not parseable; re-issuing the turn', { attempt, cause: describeCause(error) });
      }
    }
  }

  async function agentTurn(request: AgentTurnRequest, onDelta: (delta: string) => void): Promise<AgentTurnResult> {
    const api = client();
    const body: BetaMessageStreamParams = {
      ...baseRequest(request),
      tools: toAnthropicTools(request.tools),
      tool_choice: { type: 'auto' },
      messages: toAnthropicMessages(request.messages, request.model),
    };
    const message = await guarded(request.signal, () => streamTurn(api, body, request, onDelta));
    return parseAgentTurn(message);
  }

  return { id: 'anthropic', complete, stream, agentTurn };
}
