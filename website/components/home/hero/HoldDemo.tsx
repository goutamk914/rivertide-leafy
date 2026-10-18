'use client';

import { useEffect, type KeyboardEvent, type PointerEvent } from 'react';
import { Globe } from 'lucide-react';
import { LeafySprite, type LeafyMood } from '@rivertide/leafy';
import { HERO_WORDS } from '@/content/demo';
import { useIslandActions } from '@/components/island/IslandProvider';
import { listeningScene, missedScene, pastedScene, polishingScene, silent } from '@/components/island/activities';
import { useHoldDemo, type DemoPhase, type DemoState } from './useHoldDemo';

const MOODS: Record<DemoPhase, LeafyMood> = {
  idle: 'idle',
  listening: 'listening',
  locked: 'listening',
  tapWait: 'listening',
  polishing: 'thinking',
  pasted: 'success',
  missed: 'confirm',
};

const STATUS: Record<DemoPhase, string> = {
  idle: 'Hold fn. Rivertide listens while you hold it.',
  listening: 'Listening. Let go when you are done.',
  locked: 'Locked on. Press fn again to finish.',
  tapWait: 'Listening. Let go when you are done.',
  polishing: 'Polishing what you said.',
  pasted: 'Typed where your cursor was. Hold fn to go again.',
  missed: 'Didn’t catch that. Hold fn while you talk.',
};

const PASTED_HOLD_MS = 2400;
const MISSED_HOLD_MS = 2600;

/**
 * Mirrors the demo on the navigation island, the way the app's island follows the fn key. The
 * scenes are silent: the demo's own status line is what screen readers hear.
 */
function useIslandMirror(phase: DemoPhase) {
  const { show, clear } = useIslandActions();
  useEffect(() => {
    if (phase === 'listening' || phase === 'locked' || phase === 'tapWait') show(silent(listeningScene()));
    else if (phase === 'polishing') show(silent(polishingScene()));
    else if (phase === 'pasted') show(silent(pastedScene('Notes')), PASTED_HOLD_MS);
    else if (phase === 'missed') show(silent(missedScene()), MISSED_HOLD_MS);
  }, [phase, show]);
  useEffect(() => () => clear(), [clear]);
}

/** If the window loses focus mid-hold, the key-up never arrives; let go for the user. */
function useReleaseOnWindowBlur(holding: boolean, release: () => void) {
  useEffect(() => {
    if (!holding) return undefined;
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, [holding, release]);
}

function Transcript({ state }: { readonly state: DemoState }) {
  const polished = state.phase === 'polishing' || state.phase === 'pasted';
  const dropped = new Set(polished ? state.result?.dropped : []);
  if (state.heard === 0) return <p className="hold-demo__placeholder">What you say shows up here, word for word.</p>;
  return (
    <p className="hold-demo__heard">
      {HERO_WORDS.slice(0, state.heard).map((word, index) => (
        <span key={index} className={dropped.has(index) ? 'hold-demo__word is-dropped' : 'hold-demo__word'}>
          {word}{' '}
        </span>
      ))}
    </p>
  );
}

function Typed({ state }: { readonly state: DemoState }) {
  if (state.phase === 'pasted' && state.result) {
    return (
      <p key={state.result.cleaned} className="hold-demo__typed rt-materialize">
        {state.result.cleaned}
        <span className="rt-caret" aria-hidden="true" />
      </p>
    );
  }
  return <p className="hold-demo__placeholder">Rivertide types the clean version here.</p>;
}

/**
 * Hero demo: a real keycap you hold (pointer or Space/Enter), Leafy reacting, the island showing
 * the live activity, and the messy words turning into the sentence you meant.
 */
export function HoldDemo() {
  const { state, press, release, playExample } = useHoldDemo();
  useIslandMirror(state.phase);
  const pressed = state.phase === 'listening' || state.phase === 'tapWait';
  useReleaseOnWindowBlur(state.phase === 'listening', release);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) press();
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    release();
  };

  return (
    <div className="hold-demo rt-panel">
      <div className="hold-demo__screen">
        <p className="rt-label">Heard</p>
        <Transcript state={state} />
        <div className="hold-demo__rule" aria-hidden="true" />
        <p className="rt-label">Typed</p>
        <Typed state={state} />
      </div>

      <div className="hold-demo__controls">
        <button
          type="button"
          className="rt-key hold-demo__key"
          data-pressed={pressed || state.phase === 'locked'}
          aria-label="fn key. Hold to talk, or press twice to lock listening on."
          onPointerDown={onPointerDown}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={release}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="hold-demo__fn">fn</span>
          <Globe className="hold-demo__globe" size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>

        <div className="hold-demo__copy">
          <p className="hold-demo__status" role="status" aria-live="polite">
            {STATUS[state.phase]}
            {state.phase === 'pasted' && state.result ? <span className="sr-only"> It typed: {state.result.cleaned}</span> : null}
          </p>
          <p className="hold-demo__hint">
            Press it twice to keep listening.{' '}
            <button type="button" className="hold-demo__play" onClick={playExample}>
              Play the example
            </button>
          </p>
        </div>

        <LeafySprite mood={MOODS[state.phase]} scale={3} decorative className="hold-demo__leafy" />
      </div>
    </div>
  );
}
