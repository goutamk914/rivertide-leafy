/**
 * OpenAI-compatible chat provider (groq, openai, openrouter, ollama, custom) over `fetch`:
 * `POST {base}/chat/completions`, SSE streaming, tool calls and JSON mode. Ollama needs no key.
 */
import type { Logger } from '../../services';
import { abortCode, codeForStatus, describeCause, LlmError } from './errors';
import {
  chatBody, mapFinishReason, parseOaResponse, toOaMessages, toOaSimpleMessages, toOaTools, turnFromStream,
  type OaMessage, type OpenAiCompatibleId,
} from './openai-convert';
import { accumulateChatStream, parseSse } from './sse';
import type { AgentTurnRequest, AgentTurnResult, LlmProvider, ProviderCompletion, ProviderRequest } from './types';
import { stripCodeFence } from './types';

const COMPLETE_TIMEOUT_MS = 30_000;
const STREAM_TIMEOUT_MS = 60_000;
const ERROR_BODY_PREVIEW = 300;

export interface EndpointConfig {
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
}

export interface OpenAiCompatibleDeps {
  readonly providerId: OpenAiCompatibleId;
  readonly getConfig: () => EndpointConfig;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
}

/** Ollama never needs a key; a custom server may be keyless (e.g. LM Studio on the LAN). */
const needsKey = (providerId: OpenAiCompatibleId): boolean => providerId !== 'ollama' && providerId !== 'custom';

export function createOpenAiCompatibleProvider(deps: OpenAiCompatibleDeps): LlmProvider {
  const { providerId } = deps;
  const log = deps.logger.child(providerId);
  const fetchImpl = deps.fetchImpl ?? fetch;

  function endpoint(): { url: string; headers: Record<string, string> } {
    const { baseUrl, apiKey } = deps.getConfig();
    if (!baseUrl || (needsKey(providerId) && !apiKey)) throw new LlmError('not-configured', providerId);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    if (providerId === 'openrouter') {
      headers['http-referer'] = 'https://codethecure.org';
      headers['x-title'] = 'Rivertide';
    }
    return { url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`, headers };
  }

  async function post(body: Record<string, unknown>, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
    const { url, headers } = endpoint();
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: combined });
    } catch (error) {
      throw networkError(error, signal);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      log.warn('request rejected', { status: response.status });
      log.debug('rejection body', { body: detail.slice(0, ERROR_BODY_PREVIEW) });
      throw new LlmError(codeForStatus(response.status), providerId, { cause: new Error(`HTTP ${response.status}`) });
    }
    return response;
  }

  function networkError(error: unknown, signal: AbortSignal | undefined): LlmError {
    if (error instanceof LlmError) return error;
    const name = error instanceof Error ? error.name : '';
    const code = name === 'AbortError' || name === 'TimeoutError' ? abortCode(signal) : 'connection';
    if (code !== 'cancelled') log.warn('request failed', { code, cause: describeCause(error) });
    return new LlmError(code, providerId, { cause: error });
  }

  async function readStream(response: Response, signal: AbortSignal | undefined, onDelta: (delta: string) => void) {
    if (!response.body) throw new LlmError('empty', providerId);
    try {
      return await accumulateChatStream(parseSse(response.body as unknown as AsyncIterable<Uint8Array>), onDelta);
    } catch (error) {
      throw networkError(error, signal);
    }
  }

  function bodyFor(request: ProviderRequest | AgentTurnRequest, json: boolean, stream: boolean, messages: readonly OaMessage[]) {
    return chatBody({ providerId, model: request.model, system: request.system, maxTokens: request.maxTokens, effort: request.effort, json, stream }, messages);
  }

  async function complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const response = await post(bodyFor(request, request.json, false, toOaSimpleMessages(request.messages)), request.signal, COMPLETE_TIMEOUT_MS);
    const raw: unknown = await response.json().catch((error: unknown) => { throw networkError(error, request.signal); });
    const parsed = parseOaResponse(raw);
    if (!parsed) throw new LlmError('invalid-output', providerId);
    const choice = parsed.choices[0];
    if (mapFinishReason(choice.finish_reason, false) === 'refusal') throw new LlmError('refused', providerId);
    const text = (choice.message.content ?? '').trim();
    if (!text) throw new LlmError('empty', providerId);
    return { text: request.json ? stripCodeFence(text) : text, model: parsed.model ?? request.model };
  }

  async function stream(request: ProviderRequest, onDelta: (delta: string) => void): Promise<ProviderCompletion> {
    const response = await post(bodyFor(request, request.json, true, toOaSimpleMessages(request.messages)), request.signal, STREAM_TIMEOUT_MS);
    const result = await readStream(response, request.signal, onDelta);
    if (mapFinishReason(result.finishReason, false) === 'refusal') throw new LlmError('refused', providerId);
    const text = result.text.trim();
    if (!text) throw new LlmError('empty', providerId);
    return { text: request.json ? stripCodeFence(text) : text, model: result.model ?? request.model };
  }

  async function agentTurn(request: AgentTurnRequest, onDelta: (delta: string) => void): Promise<AgentTurnResult> {
    const body = {
      ...bodyFor(request, false, true, toOaMessages(request.messages, providerId)),
      ...(request.tools.length > 0 ? { tools: toOaTools(request.tools), tool_choice: 'auto' } : {}),
    };
    const response = await post(body, request.signal, STREAM_TIMEOUT_MS);
    const result = await readStream(response, request.signal, onDelta);
    return turnFromStream(result, providerId, request.model);
  }

  return { id: providerId, complete, stream, agentTurn };
}
