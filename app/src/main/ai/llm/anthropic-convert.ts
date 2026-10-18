/**
 * Pure request shaping and response parsing for the Anthropic provider (no network, no SDK client).
 * Kept separate from anthropic.ts so the exact request bodies are unit-testable.
 */
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaTextBlockParam,
  MessageCreateParamsBase,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { CompletionMessage } from '../../services';
import type { AgentMessage, AgentTurnResult, Effort, ToolCall, ToolSpec, TurnStop } from './types';
import { JSON_INSTRUCTION } from './types';

/** Server-side refusal fallback ("default" routing) — Opus/Sonnet class models only, never Haiku. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);
/** Models that accept `role: "system"` messages mid-conversation (used for the trailing context). */
const MID_SYSTEM_MODELS = /^claude-(opus-5|opus-4-8|fable-5|mythos-5|sonnet-5-5|haiku-5-5)/;
/** Block types that must not be echoed back when they precede a mid-output fallback boundary. */
const PRE_FALLBACK_DROP: ReadonlySet<string> = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);

export const supportsFallback = (model: string): boolean => FALLBACK_MODELS.has(model);
export const supportsMidConversationSystem = (model: string): boolean => MID_SYSTEM_MODELS.test(model);

export interface BaseRequestInput {
  readonly model: string;
  readonly system: string;
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly json?: boolean;
}

/**
 * Common body for every request: cached system block first (prompt caching), effort via
 * output_config, thinking omitted (always adaptive on 5.5 models — an explicit disable is a 400),
 * and the server-side fallback for models that support it.
 */
export function baseRequest(input: BaseRequestInput): MessageCreateParamsBase {
  const systemText = input.json ? `${input.system}\n\n${JSON_INSTRUCTION}` : input.system;
  const system: BetaTextBlockParam[] = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
  const fallback = supportsFallback(input.model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {};
  return {
    model: input.model,
    max_tokens: input.maxTokens,
    system,
    output_config: { effort: input.effort },
    messages: [],
    ...fallback,
  };
}

export function toSimpleMessages(messages: readonly CompletionMessage[]): BetaMessageParam[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

export function toAnthropicTools(tools: readonly ToolSpec[]): BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { type: 'object', ...tool.inputSchema } as BetaTool.InputSchema,
    strict: true,
    eager_input_streaming: true,
  }));
}

function assistantContent(message: Extract<AgentMessage, { role: 'assistant' }>): BetaContentBlockParam[] | string {
  // Replay Claude's own blocks unchanged (thinking blocks must round-trip). Blocks from another
  // Claude model are dropped server-side, unbilled, so they are safe to send as-is.
  if (message.native?.providerId === 'anthropic' && Array.isArray(message.native.content)) {
    return message.native.content as BetaContentBlockParam[];
  }
  const text: BetaContentBlockParam[] = message.text ? [{ type: 'text', text: message.text }] : [];
  const tools: BetaContentBlockParam[] = message.toolCalls.map((call) => ({
    type: 'tool_use', id: call.id, name: call.name, input: call.input ?? {},
  }));
  const blocks = [...text, ...tools];
  return blocks.length > 0 ? blocks : '…';
}

function toolResults(message: Extract<AgentMessage, { role: 'tool' }>): BetaToolResultBlockParam[] {
  return message.results.map((result) => ({
    type: 'tool_result',
    tool_use_id: result.callId,
    content: result.content,
    ...(result.isError ? { is_error: true } : {}),
  }));
}

/** Neutral transcript → Anthropic messages. All tool results of a round go in ONE user message. */
export function toAnthropicMessages(messages: readonly AgentMessage[], model: string): BetaMessageParam[] {
  const midSystem = supportsMidConversationSystem(model);
  return messages.map((message): BetaMessageParam => {
    switch (message.role) {
      case 'user':
        return { role: 'user', content: message.text };
      case 'context':
        return midSystem
          ? { role: 'system', content: message.text }
          : { role: 'user', content: `<context>\n${message.text}\n</context>` };
      case 'assistant':
        return { role: 'assistant', content: assistantContent(message) };
      case 'tool':
        return { role: 'user', content: toolResults(message) };
    }
  });
}

/**
 * After a mid-output fallback, thinking/tool_use blocks that precede the final `fallback` block
 * must not be echoed back (and their tool calls never ran on the serving model).
 */
export function sanitizeForReplay(content: readonly BetaContentBlock[]): BetaContentBlock[] {
  const boundary = content.map((block) => block.type).lastIndexOf('fallback');
  if (boundary < 0) return [...content];
  return content.filter((block, index) => index > boundary || !PRE_FALLBACK_DROP.has(block.type));
}

export function textOf(content: readonly BetaContentBlock[]): string {
  return content
    .filter((block): block is Extract<BetaContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export function mapStopReason(reason: BetaMessage['stop_reason']): TurnStop {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/** Parses a finished agent turn. Refusals are checked before any content is read. */
export function parseAgentTurn(message: BetaMessage): AgentTurnResult {
  if (message.stop_reason === 'refusal') {
    return { text: '', toolCalls: [], stop: 'refusal', native: null, model: message.model };
  }
  const content = sanitizeForReplay(message.content);
  const toolCalls: ToolCall[] = content
    .filter((block): block is Extract<BetaContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => ({ id: block.id, name: block.name, input: block.input }));
  return {
    text: textOf(content),
    toolCalls,
    stop: mapStopReason(message.stop_reason),
    native: { providerId: 'anthropic', model: message.model, content },
    model: message.model,
  };
}
