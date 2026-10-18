/**
 * Provider-neutral types shared by the LLM router and the agent loop.
 *
 * The agent keeps a neutral transcript (`AgentMessage[]`). Assistant turns also carry the
 * provider-native content (`native`) so a provider can replay its own blocks unchanged — Claude's
 * thinking blocks must round-trip exactly on the next request.
 */
import type { CompletionMessage } from '../../services';
import type { LlmProviderId } from '../../../shared/settings';

/** Thinking depth. Polish/answer/extract run `low`, agent/chat `medium`. */
export type Effort = 'low' | 'medium' | 'high';

export interface ProviderRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly CompletionMessage[];
  readonly maxTokens: number;
  readonly json: boolean;
  readonly effort: Effort;
  readonly signal?: AbortSignal;
}

export interface ProviderCompletion {
  readonly text: string;
  /** The model that actually answered (may differ after a server-side fallback). */
  readonly model: string;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema (object) already sanitised for provider structured-tool limits. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Parsed but NOT validated: the loop validates with the tool's zod schema. */
  readonly input: unknown;
}

export interface ToolResultEntry {
  readonly callId: string;
  readonly name: string;
  readonly content: string;
  readonly isError: boolean;
}

export interface NativeContent {
  readonly providerId: LlmProviderId;
  readonly model: string;
  /** Provider-native assistant content (Anthropic content blocks / OpenAI message object). */
  readonly content: unknown;
}

export type AgentMessage =
  | { readonly role: 'user'; readonly text: string }
  /** Volatile per-request context (date, time, platform) kept OUT of the cached system prompt. */
  | { readonly role: 'context'; readonly text: string }
  | { readonly role: 'assistant'; readonly text: string; readonly toolCalls: readonly ToolCall[]; readonly native: NativeContent | null }
  | { readonly role: 'tool'; readonly results: readonly ToolResultEntry[] };

export type TurnStop = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface AgentTurnRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens: number;
  readonly effort: Effort;
  readonly signal?: AbortSignal;
}

export interface AgentTurnResult {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly stop: TurnStop;
  readonly native: NativeContent | null;
  readonly model: string;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  complete(request: ProviderRequest): Promise<ProviderCompletion>;
  stream(request: ProviderRequest, onDelta: (delta: string) => void): Promise<ProviderCompletion>;
  agentTurn(request: AgentTurnRequest, onDelta: (delta: string) => void): Promise<AgentTurnResult>;
}

/** Instruction appended to the system prompt whenever a caller asks for JSON. */
export const JSON_INSTRUCTION =
  'Respond with exactly one JSON object and nothing else: no prose, no explanations, no Markdown code fences.';

/** Removes a wrapping ```json fence some models add despite instructions. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}
