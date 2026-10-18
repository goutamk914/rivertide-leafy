import { useEffect, useRef } from 'react';
import { CircleAlert } from 'lucide-react';
import type { PendingConfirmation, VoiceSnapshot } from '@shared/types';
import type { AgentRunState, RunBook } from '../lib/hooks/agentRun';
import { isBusyPhase, phaseStatus } from '../lib/hooks/voiceCopy';
import { ConfirmCard, RunView, Thinking } from './RunView';
import type { Turn } from './usePaletteAgent';

export interface AskThreadProps {
  readonly turns: readonly Turn[];
  readonly book: RunBook;
  /** Pending confirmation of the current run (already filtered for answered ones). */
  readonly pending: PendingConfirmation | null;
  readonly onAnswer: (confirmation: PendingConfirmation, approved: boolean) => void;
}

/** The Ask conversation: each question and Leafy's reply, newest at the bottom. */
export function AskThread({ turns, book, pending, onAnswer }: AskThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = turns[turns.length - 1];
  const lastRun = last?.runId ? book.runs.get(last.runId) : undefined;
  const progress = `${turns.length}:${lastRun?.text.length ?? 0}:${lastRun?.steps.length ?? 0}:${pending?.callId ?? ''}`;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [progress]);

  const announcement = lastRun?.status === 'done' ? lastRun.text : lastRun?.status === 'failed' ? 'Leafy couldn’t finish that.' : '';
  return (
    <div className="pl-thread pl-enter">
      <p className="pl-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {turns.map((turn, index) => {
        const isCurrent = index === turns.length - 1;
        const run = turn.runId ? book.runs.get(turn.runId) ?? null : null;
        return (
          <article key={turn.id} className="pl-turn" data-current={isCurrent}>
            <p className="pl-turn__question">{turn.question}</p>
            {turn.error ? (
              <p className="pl-error">
                <CircleAlert size={16} strokeWidth={2} aria-hidden />
                {turn.error}
              </p>
            ) : (
              <RunView run={run} pending={isCurrent ? pending : null} onAnswer={onAnswer} />
            )}
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

export interface VoiceViewProps {
  readonly snapshot: VoiceSnapshot;
  readonly run: AgentRunState | null;
  readonly pending: PendingConfirmation | null;
  readonly onAnswer: (confirmation: PendingConfirmation, approved: boolean) => void;
}

/** A voice command started from the palette: status, then whatever Leafy did and said. */
export function VoiceView({ snapshot, run, pending, onAnswer }: VoiceViewProps) {
  const status = phaseStatus(snapshot);
  const hearing = snapshot.phase === 'listening' || snapshot.phase === 'transcribing';
  const working = !run && !pending && isBusyPhase(snapshot.phase);
  const reply = !run?.text && (snapshot.phase === 'done' || snapshot.phase === 'speaking') ? snapshot.output : '';
  const failed = snapshot.phase === 'error' && snapshot.error && snapshot.error.code !== 'cancelled' ? snapshot.error : null;
  return (
    <div className="pl-thread pl-enter">
      <p className="pl-sr-only" role="status" aria-live="polite">
        {snapshot.phase === 'done' ? reply || status : ''}
      </p>
      <article className="pl-turn" data-current="true">
        {snapshot.transcript && !hearing ? <p className="pl-turn__question">{snapshot.transcript}</p> : null}
        {snapshot.phase === 'idle' ? <Thinking label="Getting ready" /> : null}
        {snapshot.phase === 'listening' ? (
          <p className="pl-listen-hint">Speak naturally. I’ll stop when you pause, or press the mic when you’re done.</p>
        ) : null}
        {(snapshot.phase === 'transcribing' || working) && status ? <Thinking label={status} /> : null}
        {run ? <RunView run={run} pending={pending} onAnswer={onAnswer} /> : null}
        {!run && pending ? <ConfirmCard confirmation={pending} onAnswer={onAnswer} /> : null}
        {reply ? <div className="pl-reply">{reply}</div> : null}
        {!run && !reply && snapshot.phase === 'done' ? <p className="pl-done">{status}</p> : null}
        {failed ? (
          <p className="pl-error">
            <CircleAlert size={16} strokeWidth={2} aria-hidden />
            {failed.message}
          </p>
        ) : null}
      </article>
    </div>
  );
}
