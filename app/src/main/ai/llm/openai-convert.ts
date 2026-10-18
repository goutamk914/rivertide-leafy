/**
 * Pure request/response shaping for OpenAI-compatible `/chat/completions` servers
 * (Groq, OpenAI, OpenRouter, Ollama, custom). No network here.
 */
import { z } from 'zod';
import type { CompletionMessage } from '../../services';
import type { LlmProviderId } from '../../../shared/settings';
import type { AccumulatedStream } from './sse';
import { safeJson } from './sse';
import type { AgentMessage, AgentTurnResult, Effort, ToolCall, ToolSpec, TurnStop } from './types';
import { JSON_INSTRUCTION } from './types';

export type OpenAiCompatibleId = Exclude<LlmProviderId, 'anthropic'>;

export interface OaToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface OaMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly OaToolCall[];
  readonly tool_call_id?: string;
}

export interface BodyInput {
  readonly providerId: OpenAiCompatibleId;
  readonly model: string;
  readonly system: string;
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly json: boolean;
  readonly stream: boolean;
}

const REASONING_MODELS: Readonly<Partial<Record<OpenAiCompatibleId, RegExp>>> = {
  openai: /^(gpt-5|o\d)/,
  groq: /gpt-oss/,
};

/** Builds the common body. Only OpenAI/Groq reasoning models get `reasoning_effort`. */
export function chatBody(input: BodyInput, messages: readonly OaMessage[]): Record<string, unknown> {
  const system = input.json ? `${input.system}\n\n${JSON_INSTRUCTION}` : input.system;
  const tokenKey = input.providerId === 'openai' || input.providerId === 'groq' ? 'max_completion_tokens' : 'max_tokens';
  const reasoning = REASONING_MODELS[input.providerId]?.test(input.model) ? { reasoning_effort: input.effort } : {};
  return {
    model: input.model,
    messages: [{ role: 'system', content: system }, ...messages],
    [tokenKey]: input.maxTokens,
    ...(input.stream ? { stream: true } : {}),
    ...(input.json ? { response_format: { type: 'json_object' } } : {}),
    ...reasoning,
  };
}

export const toOaSimpleMessages = (messages: readonly CompletionMessage[]): OaMessage[] =>
  messages.map((message) => ({ role: message.role, content: message.content }));

export function toOaTools(tools: readonly ToolSpec[]): readonly Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

function assistantMessage(message: Extract<AgentMessage, { role: 'assistant' }>, providerId: OpenAiCompatibleId): OaMessage {
  if (message.native?.providerId === providerId && isOaMessage(message.native.content)) return message.native.content;
  const toolCalls: OaToolCall[] = message.toolCalls.map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: typeof call.input === 'string' ? call.input : JSON.stringify(call.input ?? {}) },
  }));
  return { role: 'assistant', content: message.text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) };
}

/** Neutral transcript → OpenAI messages (one `tool` message per result, in call order). */
export function toOaMessages(messages: readonly AgentMessage[], providerId: OpenAiCompatibleId): OaMessage[] {
  return messages.flatMap((message): OaMessage[] => {
    switch (message.role) {
      case 'user':
        return [{ role: 'user', content: message.text }];
      case 'context':
        return [{ role: 'system', content: message.text }];
      case 'assistant':
        return [assistantMessage(message, providerId)];
      case 'tool':
        return message.results.map((result) => ({
          role: 'tool',
          tool_call_id: result.callId,
          content: result.isError ? `ERROR: ${result.content}` : result.content,
        }));
    }
  });
}

const OaToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const OaResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({
      role: z.string().optional(),
      content: z.string().nullable().optional(),
      tool_calls: z.array(OaToolCallSchema).nullable().optional(),
    }),
  })).min(1),
});

export type OaResponse = z.infer<typeof OaResponseSchema>;

export function parseOaResponse(raw: unknown): OaResponse | null {
  const parsed = OaResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function isOaMessage(value: unknown): value is OaMessage {
  return typeof value === 'object' && value !== null && (value as { role?: unknown }).role === 'assistant';
}

export function mapFinishReason(reason: string | null | undefined, hasToolCalls: boolean): TurnStop {
  if (hasToolCalls && (reason === 'tool_calls' || reason === 'stop' || reason === 'function_call' || !reason)) return 'tool_use';
  switch (reason) {
    case 'stop':
    case 'end_turn':
      return 'end';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return reason ? 'other' : 'end';
  }
}

/** Arguments that are not valid JSON stay a raw string; the loop reports them as INVALID_JSON. */
export function parseToolArguments(raw: string): unknown {
  if (raw.trim() === '') return {};
  const parsed = safeJson(raw);
  return parsed === undefined ? raw : parsed;
}

/** Builds the neutral turn result from a streamed response. */
export function turnFromStream(stream: AccumulatedStream, providerId: OpenAiCompatibleId, requestedModel: string): AgentTurnResult {
  const toolCalls: ToolCall[] = stream.toolCalls.map((call, index) => ({
    id: call.id || `call_${index}`,
    name: call.name,
    input: parseToolArguments(call.arguments),
  }));
  const native: OaMessage = {
    role: 'assistant',
    content: stream.text || null,
    ...(toolCalls.length > 0
      ? { tool_calls: toolCalls.map((call, index) => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: stream.toolCalls[index].arguments || '{}' } })) }
      : {}),
  };
  const model = stream.model ?? requestedModel;
  const stop = mapFinishReason(stream.finishReason, toolCalls.length > 0);
  return { text: stream.text, toolCalls, stop, native: { providerId, model, content: native }, model };
}
