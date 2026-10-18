/**
 * Links voice command sessions to agent runs: binds a run to the session that started it, turns
 * agent events into voice phases, and tracks the one pending confirmation so a spoken "yes"/"no"
 * (or the island's buttons) can answer it.
 */
import type { AgentEvent, Id, PendingConfirmation, VoicePhase, VoiceSnapshot } from '../../shared/types';
import type { LeafyCue } from '../../shared/types';
import { cue, moodForTool } from './feedback';

export interface BridgeDeps {
  readonly update: (sessionId: Id, phase: VoicePhase | null, patch: Partial<VoiceSnapshot>) => void;
  readonly current: () => VoiceSnapshot;
  readonly restore: (snapshot: VoiceSnapshot) => void;
  readonly leafy: (sessionId: Id, value: LeafyCue) => void;
  readonly onConfirm: (sessionId: Id, confirmation: PendingConfirmation) => void;
  readonly confirm: (runId: Id, callId: Id, approved: boolean) => void;
}

interface Pending {
  readonly sessionId: Id;
  readonly confirmation: PendingConfirmation;
  readonly saved: VoiceSnapshot;
}

export interface AgentBridge {
  expectRun(sessionId: Id): void;
  handle(event: AgentEvent): void;
  pending(): PendingConfirmation | null;
  pendingSession(): Id | null;
  /** Answers the pending confirmation; restores the confirming session's snapshot. */
  answer(approved: boolean, restoreForeground: boolean): boolean;
  /** Puts the confirming session (still waiting for an answer) back on the island. */
  showPending(): boolean;
  runFor(sessionId: Id): Id | null;
  forget(sessionId: Id): void;
}

export function createAgentBridge(deps: BridgeDeps): AgentBridge {
  let expecting: Id | null = null;
  let pending: Pending | null = null;
  const runToSession = new Map<Id, Id>();

  function onEvent(sessionId: Id, event: AgentEvent): void {
    switch (event.type) {
      case 'tool-start':
        // Approved (e.g. with the island's buttons): the confirmation is no longer pending.
        if (pending?.confirmation.callId === event.callId) pending = null;
        deps.update(sessionId, 'acting', { detail: event.title, pending: null });
        deps.leafy(sessionId, cue(moodForTool(event.tool)));
        return;
      case 'tool-confirm':
        pending = { sessionId, confirmation: event.confirmation, saved: deps.current() };
        deps.update(sessionId, 'confirming', { pending: event.confirmation, detail: event.confirmation.summary });
        deps.leafy(sessionId, cue('confirm', `${event.confirmation.title}?`, null));
        deps.onConfirm(sessionId, event.confirmation);
        return;
      case 'tool-end':
        if (pending?.confirmation.callId === event.callId) pending = null;
        deps.update(sessionId, null, { detail: event.summary, pending: null });
        return;
      case 'run-end':
        runToSession.delete(event.runId);
        if (pending?.confirmation.runId === event.runId) pending = null;
        return;
      default:
        return;
    }
  }

  return {
    expectRun(sessionId) {
      expecting = sessionId;
    },
    handle(event) {
      if (event.type === 'run-start') {
        if (event.source === 'voice' && expecting) runToSession.set(event.runId, expecting);
        expecting = null;
        return;
      }
      const sessionId = runToSession.get(event.runId);
      if (sessionId) onEvent(sessionId, event);
    },
    pending: () => pending?.confirmation ?? null,
    pendingSession: () => pending?.sessionId ?? null,
    answer(approved, restoreForeground) {
      if (!pending) return false;
      const { confirmation, saved } = pending;
      pending = null;
      deps.confirm(confirmation.runId, confirmation.callId, approved);
      if (restoreForeground) {
        deps.restore({ ...saved, phase: approved ? 'acting' : 'thinking', pending: null, detail: approved ? confirmation.title : 'Okay, I won’t.' });
      }
      return true;
    },
    showPending() {
      if (!pending) return false;
      const { confirmation, saved } = pending;
      deps.restore({ ...saved, phase: 'confirming', pending: confirmation, detail: confirmation.summary, error: null });
      return true;
    },
    runFor(sessionId) {
      for (const [runId, owner] of runToSession) if (owner === sessionId) return runId;
      return null;
    },
    forget(sessionId) {
      [...runToSession.entries()].filter(([, owner]) => owner === sessionId).forEach(([runId]) => runToSession.delete(runId));
      if (pending?.sessionId === sessionId) pending = null;
    },
  };
}
