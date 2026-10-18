/**
 * Provider-neutral agent loop: up to 8 model rounds within 90 s. Each round streams text, then
 * runs the requested tools (validated, policy-checked, confirmed when needed) and returns ALL
 * results in one tool message. Never runs tools from a turn cut off by max_tokens or a refusal.
 */
import type { AgentActionSummary } from '../../shared/types';
import { isLlmError } from '../ai/llm/errors';
import type { AgentMessage, AgentTurnResult, Effort, LlmProvider, ToolResultEntry, ToolSpec } from '../ai/llm/types';
import { executeCall, type ExecutorDeps } from './executor';

export interface LoopLimits {
  readonly maxRounds: number;
  readonly totalMs: number;
  readonly maxTokens: number;
}

export const DEFAULT_LOOP_LIMITS: LoopLimits = { maxRounds: 8, totalMs: 90_000, maxTokens: 16_000 };
const AGENT_EFFORT: Effort = 'medium';

export type LoopStop = 'done' | 'max-rounds' | 'timeout' | 'cancelled' | 'refused' | 'truncated' | 'error';

export interface LoopInput {
  readonly provider: Pick<LlmProvider, 'agentTurn'>;
  readonly model: string;
  readonly system: string;
  readonly history: readonly AgentMessage[];
  readonly userText: string;
  /** Volatile context (date/time/platform) sent as its own message after the user's words. */
  readonly contextText: string;
  readonly toolSpecs: readonly ToolSpec[];
  readonly executor: Omit<ExecutorDeps, 'signal'>;
  /** Caller's cancel signal; the loop adds its own overall timeout. */
  readonly signal: AbortSignal;
  readonly onText: (delta: string) => void;
  readonly limits?: Partial<LoopLimits>;
}

export interface LoopResult {
  readonly reply: string;
  readonly ok: boolean;
  readonly stop: LoopStop;
  readonly actions: readonly AgentActionSummary[];
  /** Messages this run added (user, context, assistant/tool turns) — committed only on success. */
  readonly transcript: readonly AgentMessage[];
}

const REPLIES = {
  refused: 'I can’t help with that one.',
  truncated: 'That got too long for me. Could you ask in a simpler way?',
  timeout: 'That took too long, so I stopped.',
  cancelled: 'Okay, I stopped.',
  maxRounds: 'I did as much as I could.',
  done: 'Done.',
  empty: 'I’m not sure how to help with that. Could you say it another way?',
} as const;

function lastText(transcript: readonly AgentMessage[]): string {
  const assistant = [...transcript].reverse().find((message): message is Extract<AgentMessage, { role: 'assistant' }> => message.role === 'assistant' && message.text.trim() !== '');
  return assistant?.text.trim() ?? '';
}

export async function runAgentLoop(input: LoopInput): Promise<LoopResult> {
  const limits = { ...DEFAULT_LOOP_LIMITS, ...input.limits };
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(limits.totalMs)]);
  const executor: ExecutorDeps = { ...input.executor, signal };
  const transcript: AgentMessage[] = [{ role: 'user', text: input.userText }, { role: 'context', text: input.contextText }];
  const actions: AgentActionSummary[] = [];
  let tainted = false;
  const result = (stop: LoopStop, reply: string, ok: boolean): LoopResult => ({ reply, ok, stop, actions, transcript });

  try {
    for (let round = 0; round < limits.maxRounds; round += 1) {
      const turn: AgentTurnResult = await input.provider.agentTurn({
        model: input.model, system: input.system, messages: [...input.history, ...transcript], tools: input.toolSpecs,
        maxTokens: limits.maxTokens, effort: AGENT_EFFORT, signal,
      }, input.onText);
      if (turn.stop === 'refusal') return result('refused', REPLIES.refused, false);
      if (turn.toolCalls.length === 0) {
        transcript.push({ role: 'assistant', text: turn.text, toolCalls: [], native: turn.native });
        return result('done', turn.text.trim() || (actions.length > 0 ? REPLIES.done : REPLIES.empty), true);
      }
      if (turn.stop === 'max_tokens') return result('truncated', REPLIES.truncated, false);
      transcript.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, native: turn.native });
      const results: ToolResultEntry[] = [];
      for (const call of turn.toolCalls) {
        if (signal.aborted) break; // cancelled or timed out: never start the remaining calls
        const outcome = await executeCall(executor, call, tainted);
        results.push(outcome.entry);
        if (outcome.action) actions.push(outcome.action);
        tainted = tainted || outcome.tainted;
      }
      transcript.push({ role: 'tool', results });
      if (signal.aborted) break;
    }
    if (signal.aborted) return abortResult(input.signal, result);
    return result('max-rounds', lastText(transcript) || REPLIES.maxRounds, actions.some((action) => action.ok));
  } catch (error) {
    if (signal.aborted) return abortResult(input.signal, result);
    return result('error', isLlmError(error) ? error.message : 'Something went wrong while I was working on that.', false);
  }
}

function abortResult(callerSignal: AbortSignal, result: (stop: LoopStop, reply: string, ok: boolean) => LoopResult): LoopResult {
  return callerSignal.aborted ? result('cancelled', REPLIES.cancelled, false) : result('timeout', REPLIES.timeout, false);
}
