import { useCallback, useEffect, useRef, useState } from 'react';
import type { Id, PendingConfirmation, VoiceSnapshot } from '@shared/types';
import { errorMessage } from '../lib/ipc';
import type { AgentRunState, RunBook } from '../lib/hooks/agentRun';
import { reportError, safeInvoke } from '../lib/hooks/bridge';
import { isBusyPhase } from '../lib/hooks/voiceCopy';

/** One question in the palette's Ask thread. */
export interface Turn {
  readonly id: string;
  readonly question: string;
  readonly runId: Id | null;
  readonly error: string | null;
}

const MAX_TURNS = 6;

/** The most recent voice-sourced run that started after the palette began listening. */
export function findVoiceRun(book: RunBook, baseline: ReadonlySet<Id>): AgentRunState | null {
  for (let i = book.order.length - 1; i >= 0; i -= 1) {
    const id = book.order[i];
    const run = book.runs.get(id);
    if (run && run.source === 'voice' && !baseline.has(id)) return run;
  }
  return null;
}

/** Turns, voice capture and confirmations for the palette (everything that talks to the agent). */
export function usePaletteAgent(book: RunBook, snapshot: VoiceSnapshot, onError: (message: string) => void) {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [voiceBaseline, setVoiceBaseline] = useState<ReadonlySet<Id> | null>(null);
  const [answered, setAnswered] = useState<ReadonlySet<Id>>(() => new Set());
  const turnCounter = useRef(0);
  const bookRef = useRef(book);
  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const ask = useCallback(
    (text: string) => {
      const question = text.trim();
      if (!question) return;
      turnCounter.current += 1;
      const id = `turn-${turnCounter.current}`;
      setTurns((prev) => [...prev, { id, question, runId: null, error: null }].slice(-MAX_TURNS));
      safeInvoke('agent:ask', { text: question, source: 'palette' })
        .then(({ runId }) => patchTurn(id, { runId }))
        .catch((error: unknown) => {
          reportError('agent:ask', error);
          patchTurn(id, { error: errorMessage(error) });
        });
    },
    [patchTurn],
  );

  const startVoice = useCallback(() => {
    setVoiceBaseline(new Set(bookRef.current.order));
    safeInvoke('voice:start', { mode: 'command', source: 'palette' }).catch((error: unknown) => {
      reportError('voice:start', error);
      setVoiceBaseline(null);
      onError(errorMessage(error));
    });
  }, [onError]);

  const answer = useCallback(
    (confirmation: PendingConfirmation, approved: boolean) => {
      setAnswered((prev) => new Set([...prev, confirmation.callId]));
      safeInvoke('agent:confirm', { runId: confirmation.runId, callId: confirmation.callId, approved }).catch((error: unknown) => {
        reportError('agent:confirm', error);
        setAnswered((prev) => new Set([...prev].filter((id) => id !== confirmation.callId)));
        onError(errorMessage(error));
      });
    },
    [onError],
  );

  const reset = useCallback(() => {
    setTurns([]);
    setVoiceBaseline(null);
  }, []);

  const current = turns.length ? turns[turns.length - 1] : null;
  const currentRun = current?.runId ? book.runs.get(current.runId) ?? null : null;
  const voiceRun = voiceBaseline ? findVoiceRun(book, voiceBaseline) : null;
  const askBusy = Boolean(current && !current.error && (!currentRun || currentRun.status === 'running'));
  const voiceBusy = snapshot.phase === 'listening' || isBusyPhase(snapshot.phase);

  const cancelRun = useCallback(() => {
    const runId = current?.runId;
    if (!runId) return;
    safeInvoke('agent:cancel', { runId }).catch((error: unknown) => reportError('agent:cancel', error));
  }, [current?.runId]);

  const pendingFor = (run: AgentRunState | null, fallback: PendingConfirmation | null) => {
    const pending = run?.confirmation ?? fallback;
    return pending && !answered.has(pending.callId) ? pending : null;
  };

  return {
    turns,
    currentRun,
    voiceRun,
    askBusy,
    voiceBusy,
    askPending: pendingFor(currentRun, null),
    voicePending: pendingFor(voiceRun, snapshot.pending),
    answered,
    ask,
    startVoice,
    answer,
    cancelRun,
    reset,
  };
}
