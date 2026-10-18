import { useState, type ReactNode, type RefObject } from 'react';
import { Check, CircleAlert, Leaf, Lock, RotateCcw, Settings, X } from 'lucide-react';
import type { IslandScene } from '@rivertide/island';
import { LeafySprite } from '@rivertide/leafy';
import type { AudioLevel, PendingConfirmation, VoiceMode } from '@shared/types';
import { Icon } from '../lib/hooks/Icon';
import { Waveform } from '../lib/hooks/Waveform';
import type { IslandSceneSpec, IslandView } from './sceneSpec';
import { Shimmer } from './Shimmer';

export interface IslandActions {
  readonly cancel: () => void;
  /** Rejects when main could not take the answer, so the buttons can be used again. */
  readonly confirm: (confirmation: PendingConfirmation, approved: boolean) => Promise<void>;
  readonly retry: () => void;
  readonly dismiss: () => void;
  readonly openSettings: () => void;
}

export interface RenderContext {
  readonly levelRef: RefObject<AudioLevel>;
  readonly reducedMotion: boolean;
  readonly actions: IslandActions;
}

function ModeChip({ mode, locked, reducedMotion }: { readonly mode: VoiceMode; readonly locked: boolean; readonly reducedMotion: boolean }) {
  return (
    <span className="il-chip" data-mode={mode}>
      {mode === 'dictate' ? <LeafySprite mood="listening" scale={1} decorative reducedMotion={reducedMotion} className="il-chip__leafy" /> : null}
      {mode === 'ask' ? <span className="il-chip__dot" /> : null}
      {mode === 'command' ? <Leaf className="il-chip__leaf" size={16} strokeWidth={2} aria-hidden /> : null}
      <span className="il-chip__label">{mode === 'dictate' ? 'Listening' : mode === 'ask' ? 'Ask' : 'Leafy'}</span>
      {locked ? (
        <span className="il-locked">
          <Lock size={11} strokeWidth={2.5} aria-hidden />
          Locked
        </span>
      ) : null}
    </span>
  );
}

function IconButton({ label, onClick, children }: { readonly label: string; readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button type="button" className="il-icon-btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function ConfirmBody({ confirmation, onAnswer }: { readonly confirmation: PendingConfirmation; readonly onAnswer: IslandActions['confirm'] }) {
  const [answered, setAnswered] = useState(false);
  const answer = (approved: boolean) => {
    if (answered) return;
    setAnswered(true);
    onAnswer(confirmation, approved).catch(() => setAnswered(false));
  };
  return (
    <div className="il-card il-card--confirm">
      <p className="il-card__title">{confirmation.title}</p>
      <p className="il-card__text">{confirmation.summary}</p>
      <div className="il-card__actions">
        <button type="button" className="il-btn il-btn--primary" disabled={answered} onClick={() => answer(true)}>
          Do it
        </button>
        <button type="button" className="il-btn" disabled={answered} onClick={() => answer(false)}>
          Not now
        </button>
        <span className="il-card__hint">or say yes / no</span>
      </div>
    </div>
  );
}

function ReplyBody({ text, speaking, lines }: { readonly text: string; readonly speaking: boolean; readonly lines: number }) {
  return (
    <div className="il-card">
      <p className="il-card__eyebrow">
        <Leaf size={13} strokeWidth={2} aria-hidden />
        Leafy
        {speaking ? <span className="il-speaking" role="img" aria-label="Speaking"><span /><span /><span /></span> : null}
      </p>
      <div className="il-card__reply" style={{ maxHeight: lines * 21 }}>
        {text}
      </div>
    </div>
  );
}

function ResultCard({ heading, ok, text }: { readonly heading: string; readonly ok: boolean; readonly text: string }) {
  return (
    <div className="il-card">
      <p className="il-card__eyebrow" data-tone={ok ? 'ok' : 'warn'}>
        {ok ? <Check size={14} strokeWidth={2.75} aria-hidden /> : <CircleAlert size={14} strokeWidth={2.25} aria-hidden />}
        {heading}
      </p>
      <p className="il-card__preview">{text}</p>
    </div>
  );
}

function ErrorActions({ view, actions }: { readonly view: Extract<IslandView, { kind: 'error' }>; readonly actions: IslandActions }) {
  if (view.layout === 'pill') {
    return (
      <span className="il-trailing">
        {view.retry ? (
          <IconButton label="Try again" onClick={actions.retry}>
            <RotateCcw size={15} strokeWidth={2} aria-hidden />
          </IconButton>
        ) : null}
        <IconButton label="Close" onClick={actions.dismiss}>
          <X size={15} strokeWidth={2.25} aria-hidden />
        </IconButton>
      </span>
    );
  }
  return (
    <div className="il-card__actions">
      {view.settings ? (
        <button type="button" className="il-btn il-btn--primary" onClick={actions.openSettings}>
          <Settings size={15} strokeWidth={2} aria-hidden />
          Open Settings
        </button>
      ) : null}
      {view.retry ? (
        <button type="button" className="il-btn il-btn--primary" onClick={actions.retry}>
          Try again
        </button>
      ) : null}
      <button type="button" className="il-btn" onClick={actions.dismiss}>
        Close
      </button>
    </div>
  );
}

type Slots = Pick<IslandScene, 'leading' | 'trailing' | 'body' | 'bubble'>;

function slotsFor(view: IslandView, ctx: RenderContext): Slots {
  const { actions, reducedMotion, levelRef } = ctx;
  switch (view.kind) {
    case 'listening':
      return {
        leading: <ModeChip mode={view.mode} locked={view.locked} reducedMotion={reducedMotion} />,
        trailing: (
          <span className="il-trailing">
            <Waveform levelRef={levelRef} bars={9} height={26} reducedMotion={reducedMotion} />
            {view.hovered ? (
              <IconButton label="Cancel" onClick={actions.cancel}>
                <X size={15} strokeWidth={2.25} aria-hidden />
              </IconButton>
            ) : null}
          </span>
        ),
      };
    case 'working':
      return {
        leading: <Shimmer text={view.label} reducedMotion={reducedMotion} />,
        trailing: view.preview ? <span className="il-preview il-fade-in">{view.preview}</span> : null,
      };
    case 'acting':
      return {
        leading: (
          <span className="il-detail">
            <span className="il-pulse" aria-hidden />
            {view.detail}
          </span>
        ),
        bubble: <Icon name={view.icon} size={18} strokeWidth={2} />,
      };
    case 'confirming':
      return { body: <ConfirmBody confirmation={view.confirmation} onAnswer={actions.confirm} /> };
    case 'result':
      if (view.layout === 'card') return { body: <ResultCard heading={view.heading} ok={view.ok} text={view.text} /> };
      return {
        leading: (
          <span className="il-done">
            <Check size={15} strokeWidth={2.75} aria-hidden />
            {view.heading}
          </span>
        ),
        trailing: <span className="il-preview">{view.text}</span>,
      };
    case 'reply':
      return { body: <ReplyBody text={view.text} speaking={view.speaking} lines={view.lines} /> };
    case 'error':
      if (view.layout === 'card') {
        return {
          body: (
            <div className="il-card il-card--error">
              <p className="il-card__text il-card__text--strong">{view.message}</p>
              <ErrorActions view={view} actions={actions} />
            </div>
          ),
        };
      }
      return {
        leading: (
          <span className="il-error">
            <CircleAlert size={15} strokeWidth={2.25} aria-hidden />
            <span className="il-error__text">{view.message}</span>
          </span>
        ),
        trailing: <ErrorActions view={view} actions={actions} />,
      };
    default:
      return {};
  }
}

/** Turns a pure scene spec into the `IslandScene` the shared <DynamicIsland/> renders. */
export function renderScene(spec: IslandSceneSpec, ctx: RenderContext): IslandScene {
  return { id: spec.id, mode: spec.mode, size: spec.size, label: spec.label, ...slotsFor(spec.view, ctx) };
}
