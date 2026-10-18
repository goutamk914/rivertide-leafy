/**
 * `createAgentService(ctx)` — Leafy's "Jarvis" brain.
 *  1. The deterministic router handles common commands instantly and offline.
 *  2. Everything else goes to the LLM agent loop with the full tool set.
 * Runs emit `agent:event`s on the bus; confirmations wait up to 60 s (then decline).
 */
import type { AgentActionSummary, AgentRunSource, Id, PendingConfirmation } from '../../shared/types';
import type { AgentService, AppContext } from '../services';
import { createProviderRegistry, type ProviderRegistry } from '../ai/llm/registry';
import { AGENT_SYSTEM_PROMPT, OFFLINE_CAPABILITIES, buildAgentContext } from '../ai/prompts/agent';
import { osExtras } from '../os/extras';
import { createConversationMemory, type ConversationMemory } from './conversation';
import { executeCall, type ExecutorDeps } from './executor';
import { newId } from './ids';
import { runAgentLoop, type LoopLimits } from './loop';
import { effectivePolicy } from './policy';
import { parseIntent, type Intent } from './router';
import { availableTools, createAllTools, toToolSpecs, type AnyTool } from './tools';
import type { ToolContext } from './tools/types';

export const CONFIRM_TIMEOUT_MS = 60_000;
export const TOOL_TIMEOUT_MS = 15_000;
const CANCELLED = { reply: 'Okay, I stopped.', ok: false, actions: [] } as const;

/** Resolves with the cancelled outcome as soon as the run's signal aborts. */
function whenCancelled(signal: AbortSignal): Promise<Omit<RunResult, 'runId'>> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(CANCELLED);
    else signal.addEventListener('abort', () => resolve(CANCELLED), { once: true });
  });
}

export interface AgentServiceOptions {
  readonly registry?: ProviderRegistry;
  readonly tools?: readonly AnyTool[];
  readonly now?: () => Date;
  readonly limits?: Partial<LoopLimits>;
  readonly confirmTimeoutMs?: number;
}

interface RunState {
  readonly controller: AbortController;
  readonly pending: Map<Id, (approved: boolean) => void>;
}

export type RunResult = { readonly runId: Id; readonly reply: string; readonly ok: boolean; readonly actions: readonly AgentActionSummary[] };

export function createAgentService(ctx: AppContext, options: AgentServiceOptions = {}): AgentService {
  const runs = new Map<Id, RunState>();
  const now = options.now ?? (() => new Date());
  const memory: ConversationMemory = createConversationMemory(() => now().getTime());
  let registry: ProviderRegistry | null = options.registry ?? null;
  let allTools: readonly AnyTool[] | null = options.tools ?? null;
  const providers = () => (registry ??= createProviderRegistry(ctx));
  const tools = () => (allTools ??= createAllTools());
  const log = () => ctx.logger.child('agent');

  function waitForConfirmation(state: RunState, confirmation: PendingConfirmation, signal: AbortSignal): Promise<boolean> {
    // An already-aborted signal never fires 'abort' again: decline straight away.
    if (signal.aborted || !runs.has(confirmation.runId)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (approved: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        state.pending.delete(confirmation.callId);
        resolve(approved);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), options.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS);
      state.pending.set(confirmation.callId, finish);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function executorFor(runId: Id, state: RunState, source: AgentRunSource, enabled: readonly AnyTool[]): Omit<ExecutorDeps, 'signal'> {
    const toolContext = (signal: AbortSignal): ToolContext => ({
      app: ctx, os: osExtras(ctx.os), now, signal, source, remember: (items) => memory.remember(items),
    });
    return {
      runId,
      tools: new Map(enabled.map((tool) => [tool.name, tool])),
      policyFor: (tool, tainted) => effectivePolicy(tool, ctx.settings.get().agent.toolPolicy, tainted),
      emit: (event) => ctx.bus.emit('agent:event', event),
      confirm: (confirmation, signal) => waitForConfirmation(state, confirmation, signal),
      toolContext,
      toolTimeoutMs: TOOL_TIMEOUT_MS,
      newId: () => newId(),
    };
  }

  /** "open the second one" → a concrete tool intent from the last remembered list. */
  function resolveFollowUp(intent: Extract<Intent, { kind: 'follow-up' }>): Intent | string | null {
    const remembered = memory.get().remembered;
    if (!remembered || remembered.items.length === 0) return null;
    const index = intent.index < 0 ? remembered.items.length + intent.index : intent.index;
    const item = remembered.items[index];
    if (!item) return `I only have ${remembered.items.length} in that list. Which one did you mean?`;
    if (remembered.kind === 'apps') return { kind: 'tool', tool: 'open_app', input: { name: item.name } };
    return { kind: 'tool', tool: intent.action === 'reveal' ? 'reveal_file' : 'open_file', input: { path: item.path } };
  }

  async function runIntent(runId: Id, state: RunState, text: string, intent: Extract<Intent, { kind: 'tool' }>, source: AgentRunSource): Promise<Omit<RunResult, 'runId'>> {
    const enabled = availableTools(tools(), ctx.settings.get());
    const executor = executorFor(runId, state, source, enabled);
    const call = { id: newId(), name: intent.tool, input: intent.input };
    const result = await executeCall({ ...executor, signal: state.controller.signal }, call, false);
    if (state.controller.signal.aborted) return CANCELLED;
    const reply = result.outcome?.summary ?? (result.action ? 'Okay, I didn’t do it.' : 'That’s switched off in Settings.');
    memory.commit([{ role: 'user', text }, { role: 'assistant', text: reply, toolCalls: [], native: null }]);
    return { reply, ok: result.outcome?.ok ?? false, actions: result.action ? [result.action] : [] };
  }

  async function runLlm(runId: Id, state: RunState, text: string, source: AgentRunSource): Promise<Omit<RunResult, 'runId'>> {
    if (!providers().isRoleConfigured('agent')) return { reply: OFFLINE_CAPABILITIES, ok: false, actions: [] };
    const resolved = providers().resolve('agent');
    const settings = ctx.settings.get();
    const enabled = availableTools(tools(), settings);
    const frontmost = await ctx.os.frontmostApp().catch(() => null);
    const result = await runAgentLoop({
      provider: resolved.provider, model: resolved.model, system: AGENT_SYSTEM_PROMPT,
      history: memory.get().messages, userText: text,
      contextText: buildAgentContext({ now: now(), platform: ctx.platform, userName: settings.profile.name, frontmostApp: frontmost?.name ?? null, source }),
      toolSpecs: toToolSpecs(enabled), executor: executorFor(runId, state, source, enabled), signal: state.controller.signal,
      onText: (delta) => ctx.bus.emit('agent:event', { type: 'text', runId, delta }), limits: options.limits,
    });
    if (result.stop === 'done' || result.stop === 'max-rounds') memory.commit(result.transcript);
    log().info('agent run finished', { runId, stop: result.stop, actions: result.actions.length, providerId: resolved.providerId });
    return { reply: result.reply, ok: result.ok, actions: result.actions };
  }

  async function route(runId: Id, state: RunState, text: string, source: AgentRunSource): Promise<Omit<RunResult, 'runId'>> {
    const intent = parseIntent(text, { now: now(), resolveApp: (name) => ctx.os.apps.find(name)?.name ?? null });
    const resolved = intent?.kind === 'follow-up' ? resolveFollowUp(intent) : intent;
    if (typeof resolved === 'string') return { reply: resolved, ok: false, actions: [] };
    if (resolved?.kind === 'tool') return runIntent(runId, state, text, resolved, source);
    return runLlm(runId, state, text, source);
  }

  async function execute(runId: Id, text: string, source: AgentRunSource): Promise<RunResult> {
    // run-start is emitted synchronously so callers (voice) can bind to the run before any await.
    ctx.bus.emit('agent:event', { type: 'run-start', runId, input: text, source });
    const state: RunState = { controller: new AbortController(), pending: new Map() };
    runs.set(runId, state);
    let outcome: Omit<RunResult, 'runId'> = { reply: 'Something went wrong while I was working on that.', ok: false, actions: [] };
    try {
      // A cancel resolves the run at once, even if a provider call or tool is slow to notice.
      outcome = await Promise.race([route(runId, state, text.trim(), source), whenCancelled(state.controller.signal)]);
    } catch (error) {
      log().error('agent run failed', { runId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      runs.delete(runId);
      ctx.bus.emit('agent:event', { type: 'run-end', runId, text: outcome.reply, ok: outcome.ok });
    }
    return { runId, ...outcome };
  }

  return {
    ask(text, source) {
      const runId = newId();
      void execute(runId, text, source);
      return { runId };
    },
    run: (text, source) => execute(newId(), text, source),
    confirm(runId, callId, approved) {
      const resolve = runs.get(runId)?.pending.get(callId);
      if (resolve) resolve(approved);
      else log().debug('confirmation for an unknown or finished call', { runId, callId });
    },
    cancel(runId) {
      const state = runs.get(runId);
      if (!state) return;
      // Remove the run first so a late "yes" can never approve anything in it.
      runs.delete(runId);
      [...state.pending.values()].forEach((decline) => decline(false));
      state.controller.abort();
    },
  };
}
