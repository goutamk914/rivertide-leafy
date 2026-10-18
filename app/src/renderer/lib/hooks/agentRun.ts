/**
 * Pure folding of `agent:event` pushes into a renderable run (reply text, tool steps, a pending
 * confirmation). Shared by the palette's Ask mode, the island and Leafy.
 */
import type { AgentEvent, AgentRunSource, Id, PendingConfirmation } from '@shared/types';

export type AgentStepStatus = 'running' | 'ok' | 'failed';

export interface AgentStep {
  readonly callId: Id;
  readonly tool: string;
  /** e.g. "Opening Calendar". */
  readonly title: string;
  readonly status: AgentStepStatus;
  /** Result line from `tool-end`. */
  readonly summary: string | null;
}

export type AgentRunStatus = 'running' | 'done' | 'failed';

export interface AgentRunState {
  readonly runId: Id;
  readonly input: string;
  readonly source: AgentRunSource | null;
  /** Streamed reply so far; replaced by the final text at `run-end` when that is non-empty. */
  readonly text: string;
  readonly steps: readonly AgentStep[];
  readonly confirmation: PendingConfirmation | null;
  readonly status: AgentRunStatus;
}

export function emptyRun(runId: Id, input = '', source: AgentRunSource | null = null): AgentRunState {
  return { runId, input, source, text: '', steps: [], confirmation: null, status: 'running' };
}

function settleSteps(steps: readonly AgentStep[], ok: boolean): readonly AgentStep[] {
  return steps.map((s) => (s.status === 'running' ? { ...s, status: ok ? 'ok' : 'failed' } : s));
}

/** Applies one event. Events for other runs leave the state untouched. */
export function reduceAgentRun(state: AgentRunState, event: AgentEvent): AgentRunState {
  if (event.runId !== state.runId) return state;
  switch (event.type) {
    case 'run-start':
      return { ...state, input: event.input, source: event.source };
    case 'text':
      return { ...state, text: state.text + event.delta };
    case 'tool-start': {
      const step: AgentStep = { callId: event.callId, tool: event.tool, title: event.title, status: 'running', summary: null };
      const others = state.steps.filter((s) => s.callId !== event.callId);
      return { ...state, steps: [...others, step] };
    }
    case 'tool-confirm':
      return { ...state, confirmation: event.confirmation };
    case 'tool-end':
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.callId === event.callId ? { ...s, status: event.ok ? 'ok' : 'failed', summary: event.summary || null } : s,
        ),
        confirmation: state.confirmation?.callId === event.callId ? null : state.confirmation,
      };
    case 'run-end':
      return {
        ...state,
        text: event.text.trim() ? event.text : state.text,
        steps: settleSteps(state.steps, event.ok),
        confirmation: null,
        status: event.ok ? 'done' : 'failed',
      };
    default:
      return state;
  }
}

/** The step currently running, if any (latest first). */
export function activeStep(run: AgentRunState | null): AgentStep | null {
  if (!run) return null;
  for (let i = run.steps.length - 1; i >= 0; i -= 1) {
    if (run.steps[i].status === 'running') return run.steps[i];
  }
  return null;
}

export interface RunBook {
  /** Run ids in arrival order (oldest first). */
  readonly order: readonly Id[];
  readonly runs: ReadonlyMap<Id, AgentRunState>;
  /** The most recent run that started and passed the source filter. */
  readonly latest: Id | null;
}

export const EMPTY_RUN_BOOK: RunBook = { order: [], runs: new Map(), latest: null };

/** Keep a handful of recent runs so a long session never grows without limit. */
export const RUN_BOOK_SIZE = 12;

/**
 * Returns a new book with `event` folded into its run (immutably), evicting the oldest runs.
 * Runs are recorded from their first event, so nothing is lost when events arrive before the
 * caller learns the run id from `agent:ask`.
 */
export function recordAgentEvent(book: RunBook, event: AgentEvent, accept: (source: AgentRunSource) => boolean = () => true): RunBook {
  const previous = book.runs.get(event.runId);
  const order = previous ? book.order : [...book.order, event.runId].slice(-RUN_BOOK_SIZE);
  const updated = reduceAgentRun(previous ?? emptyRun(event.runId), event);
  const runs = new Map<Id, AgentRunState>();
  for (const id of order) {
    const run = id === event.runId ? updated : book.runs.get(id);
    if (run) runs.set(id, run);
  }
  const latest = event.type === 'run-start' && accept(event.source) ? event.runId : book.latest;
  return { order, runs, latest };
}
