import { useEffect, useState } from 'react';
import type { AgentRunSource, Id } from '@shared/types';
import { EMPTY_RUN_BOOK, recordAgentEvent, type AgentRunState, type RunBook } from './agentRun';
import { safeOn } from './bridge';

/** A specific run id, `'latest'` to follow whichever run started most recently, or null for none. */
export type RunTarget = Id | 'latest' | null;

export interface UseAgentRunOptions {
  /** With `'latest'`: only follow runs from these sources (e.g. `['voice']`). */
  readonly sources?: readonly AgentRunSource[];
}

/**
 * Every recent agent run, folded from `agent:event` pushes (see `recordAgentEvent`).
 * Mount it before calling `agent:ask`: events that arrive before the run id is known are kept,
 * so the first words of a reply are never dropped. `book.latest` respects `sources`.
 */
export function useRunBook(sources?: readonly AgentRunSource[]): RunBook {
  const [book, setBook] = useState<RunBook>(EMPTY_RUN_BOOK);
  const sourcesKey = sources?.join(',') ?? '';

  useEffect(() => {
    const allowed = sourcesKey ? new Set(sourcesKey.split(',')) : null;
    const accept = (source: AgentRunSource) => allowed === null || allowed.has(source);
    return safeOn('agent:event', (event) => setBook((current) => recordAgentEvent(current, event, accept)));
  }, [sourcesKey]);

  return book;
}

/** The folded state of one run: a specific id, or the most recent (`'latest'`). */
export function useAgentRun(target: RunTarget, options: UseAgentRunOptions = {}): AgentRunState | null {
  const book = useRunBook(options.sources);
  const runId = target === 'latest' ? book.latest : target;
  return runId ? book.runs.get(runId) ?? null : null;
}
