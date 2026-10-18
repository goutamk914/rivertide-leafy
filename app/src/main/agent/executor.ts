/**
 * Executes ONE tool call with everything around it: zod validation (invalid input → INVALID_JSON
 * error result), policy (block / ask / run), confirmation, a per-tool timeout, agent events and
 * the action summary. Shared by the LLM loop and the fast-path router.
 */
import type { AgentActionSummary, AgentEvent, Id, PendingConfirmation } from '../../shared/types';
import type { ToolCall, ToolResultEntry } from '../ai/llm/types';
import type { EffectivePolicy } from './policy';
import type { AnyTool } from './tools';
import type { ToolContext, ToolOutcome } from './tools/types';

export const MAX_RESULT_CHARS = 8000;
const STOPPED = 'Stopped.';
const ISSUE_PREVIEW = 3;

export interface ExecutorDeps {
  readonly runId: Id;
  readonly tools: ReadonlyMap<string, AnyTool>;
  readonly policyFor: (tool: AnyTool, tainted: boolean) => EffectivePolicy;
  readonly emit: (event: AgentEvent) => void;
  /** Resolves true when approved; false on decline, timeout or cancel. */
  readonly confirm: (confirmation: PendingConfirmation, signal: AbortSignal) => Promise<boolean>;
  readonly toolContext: (signal: AbortSignal) => ToolContext;
  readonly signal: AbortSignal;
  readonly toolTimeoutMs: number;
  readonly newId: () => Id;
}

export interface CallResult {
  readonly entry: ToolResultEntry;
  readonly action: AgentActionSummary | null;
  readonly outcome: ToolOutcome | null;
  /** The tool returned outside content: later egress tools need confirmation. */
  readonly tainted: boolean;
}

const errorResult = (call: ToolCall, content: string, action: AgentActionSummary | null = null): CallResult => ({
  entry: { callId: call.id, name: call.name, content, isError: true }, action, outcome: null, tainted: false,
});

function serialise(outcome: ToolOutcome): string {
  const text = JSON.stringify({ ok: outcome.ok, summary: outcome.summary, ...(outcome.data === undefined ? {} : { data: outcome.data }) });
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…(truncated)` : text;
}

async function runWithTimeout(tool: AnyTool, input: unknown, deps: ExecutorDeps): Promise<ToolOutcome> {
  const signal = AbortSignal.any([deps.signal, AbortSignal.timeout(deps.toolTimeoutMs)]);
  let timer: NodeJS.Timeout | undefined;
  let onAbort: () => void = () => undefined;
  // A tool that ignores its signal must still never hold the run open past a cancel or its limit.
  const stop = new Promise<ToolOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, summary: 'That took too long, so I stopped it.' }), deps.toolTimeoutMs);
    onAbort = () => resolve({ ok: false, summary: STOPPED });
    deps.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([tool.run(input, deps.toolContext(signal)), stop]);
  } catch {
    return { ok: false, summary: deps.signal.aborted ? STOPPED : 'That didn’t work.' };
  } finally {
    clearTimeout(timer);
    deps.signal.removeEventListener('abort', onAbort);
  }
}

export async function executeCall(deps: ExecutorDeps, call: ToolCall, tainted: boolean): Promise<CallResult> {
  const tool = deps.tools.get(call.name);
  if (!tool) return errorResult(call, `Unknown tool "${call.name}". Use only the tools provided.`);
  const parsed = tool.schema.safeParse(call.input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, ISSUE_PREVIEW).map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`);
    const raw = typeof call.input === 'string' ? call.input : JSON.stringify(call.input ?? null);
    return errorResult(call, JSON.stringify({ INVALID_JSON: raw, issues }));
  }
  if (deps.signal.aborted) return errorResult(call, STOPPED);
  const input = parsed.data;
  const title = tool.title(input);
  const policy = deps.policyFor(tool, tainted);
  if (policy === 'block') return errorResult(call, 'The person turned this tool off in Settings. Tell them it is switched off.');

  const callId = deps.newId();
  if (policy === 'ask') {
    const confirmation: PendingConfirmation = { runId: deps.runId, callId, tool: tool.name, title, summary: tool.confirmText?.(input) ?? `${title}?` };
    deps.emit({ type: 'tool-confirm', runId: deps.runId, confirmation });
    const approved = await deps.confirm(confirmation, deps.signal);
    if (!approved) {
      deps.emit({ type: 'tool-end', runId: deps.runId, callId, ok: false, summary: 'Not done.' });
      return errorResult(call, 'The person said no (or did not answer), so nothing was done. Do not try again; tell them it was not done.', { tool: tool.name, title, ok: false });
    }
    if (deps.signal.aborted) return errorResult(call, STOPPED);
  }

  deps.emit({ type: 'tool-start', runId: deps.runId, callId, tool: tool.name, title });
  const outcome = await runWithTimeout(tool, input, deps);
  deps.emit({ type: 'tool-end', runId: deps.runId, callId, ok: outcome.ok, summary: outcome.summary });
  return {
    entry: { callId: call.id, name: call.name, content: serialise(outcome), isError: !outcome.ok },
    action: { tool: tool.name, title, ok: outcome.ok },
    outcome,
    tainted: tool.untrustedOutput === true,
  };
}
