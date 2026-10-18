import { Check, LoaderCircle, X } from 'lucide-react';
import type { PendingConfirmation } from '@shared/types';
import type { AgentRunState, AgentStep } from '../lib/hooks/agentRun';
import { Icon } from '../lib/hooks/Icon';
import { toolIconName } from '../lib/hooks/iconNames';
import { keepInputFocus } from './PaletteHeader';

function StepStatus({ status }: { readonly status: AgentStep['status'] }) {
  if (status === 'running') return <LoaderCircle className="pl-step__spin" size={16} strokeWidth={2} aria-label="Working" />;
  if (status === 'ok') return <Check className="pl-step__ok" size={16} strokeWidth={2.5} aria-label="Done" />;
  return <X className="pl-step__fail" size={16} strokeWidth={2.5} aria-label="Didn’t work" />;
}

export function StepList({ steps }: { readonly steps: readonly AgentStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="pl-steps" aria-label="What Leafy did">
      {steps.map((step) => (
        <li key={step.callId} className="pl-step" data-status={step.status}>
          <span className="pl-step__icon" aria-hidden="true">
            <Icon name={toolIconName(step.tool, step.title)} size={16} />
          </span>
          <span className="pl-step__text">
            <span className="pl-step__title">{step.title}</span>
            {step.summary ? <span className="pl-step__summary">{step.summary}</span> : null}
          </span>
          <StepStatus status={step.status} />
        </li>
      ))}
    </ol>
  );
}

export interface ConfirmCardProps {
  readonly confirmation: PendingConfirmation;
  readonly onAnswer: (confirmation: PendingConfirmation, approved: boolean) => void;
}

/** Leafy asks before anything it can't undo. Big buttons, and Y / N work too. */
export function ConfirmCard({ confirmation, onAnswer }: ConfirmCardProps) {
  return (
    <section className="pl-confirm" role="alertdialog" aria-labelledby="pl-confirm-title" aria-describedby="pl-confirm-summary">
      <h2 id="pl-confirm-title" className="pl-confirm__title">
        {confirmation.title}
      </h2>
      <p id="pl-confirm-summary" className="pl-confirm__summary">
        {confirmation.summary}
      </p>
      <div className="pl-confirm__actions">
        <button type="button" className="pl-button pl-button--primary" onMouseDown={keepInputFocus} onClick={() => onAnswer(confirmation, true)}>
          Do it <kbd className="pl-kbd pl-kbd--on-accent">Y</kbd>
        </button>
        <button type="button" className="pl-button" onMouseDown={keepInputFocus} onClick={() => onAnswer(confirmation, false)}>
          Not now <kbd className="pl-kbd">N</kbd>
        </button>
      </div>
    </section>
  );
}

export function Thinking({ label = 'Thinking' }: { readonly label?: string }) {
  return (
    <p className="pl-thinking">
      <span className="pl-thinking__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {label}
    </p>
  );
}

export interface RunViewProps {
  readonly run: AgentRunState | null;
  /** Shown instead of the run's own confirmation (filters ones already answered). */
  readonly pending: PendingConfirmation | null;
  readonly onAnswer: ConfirmCardProps['onAnswer'];
}

/** One agent run: tool steps, a confirmation if needed, and the streaming reply. */
export function RunView({ run, pending, onAnswer }: RunViewProps) {
  const running = !run || run.status === 'running';
  const showThinking = running && !run?.text && !pending && !run?.steps.some((s) => s.status === 'running');
  return (
    <div className="pl-run">
      <StepList steps={run?.steps ?? []} />
      {pending ? <ConfirmCard confirmation={pending} onAnswer={onAnswer} /> : null}
      {run?.text ? (
        <div className="pl-reply" data-streaming={running}>
          {run.text}
        </div>
      ) : null}
      {showThinking ? <Thinking /> : null}
      {run?.status === 'failed' && !run.text ? <p className="pl-error">Leafy couldn’t finish that. Try asking another way.</p> : null}
    </div>
  );
}
