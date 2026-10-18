'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { HERO_WORDS, checkpointFor, type Checkpoint } from '@/content/demo';

/**
 * The hero demo behaves like the real fn key: hold to talk, let go to get clean text; press twice
 * quickly to lock it on (it stops by itself after 2.2 s of quiet, or on the next press). Holding
 * "plays" the example speech one word at a time, because the website never uses your microphone.
 */

export type DemoPhase = 'idle' | 'listening' | 'locked' | 'tapWait' | 'polishing' | 'pasted' | 'missed';

export interface DemoState {
  readonly phase: DemoPhase;
  readonly heard: number;
  readonly result: Checkpoint | null;
  readonly pressedAt: number;
  readonly ignoreRelease: boolean;
}

type Action =
  | { readonly type: 'press'; readonly at: number }
  | { readonly type: 'release'; readonly at: number }
  | { readonly type: 'word' }
  | { readonly type: 'finish' }
  | { readonly type: 'polished' };

/** Timings from the app: double-press window 450 ms, hands-free end-of-speech 2.2 s. */
export const WORD_MS = 230;
const TAP_MS = 300;
const DOUBLE_PRESS_MS = 450;
const POLISH_MS = 950;
const SILENCE_MS = 2200;
const MIN_WORDS = 4;

const INITIAL: DemoState = { phase: 'idle', heard: 0, result: null, pressedAt: 0, ignoreRelease: false };

function finish(state: DemoState): DemoState {
  const result = state.heard >= MIN_WORDS ? checkpointFor(state.heard) : null;
  return { ...state, phase: result ? 'polishing' : 'missed', result };
}

function onPress(state: DemoState, at: number): DemoState {
  if (state.phase === 'locked') return { ...finish(state), ignoreRelease: true };
  if (state.phase === 'tapWait') return { ...state, phase: 'locked', ignoreRelease: true };
  if (state.phase === 'listening' || state.phase === 'polishing') return state;
  return { ...INITIAL, phase: 'listening', pressedAt: at };
}

function onRelease(state: DemoState, at: number): DemoState {
  if (state.ignoreRelease) return { ...state, ignoreRelease: false };
  if (state.phase !== 'listening') return state;
  const quickTap = at - state.pressedAt < TAP_MS && state.heard < MIN_WORDS;
  return quickTap ? { ...state, phase: 'tapWait' } : finish(state);
}

export function demoReducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case 'press':
      return onPress(state, action.at);
    case 'release':
      return onRelease(state, action.at);
    case 'word':
      return state.phase === 'listening' || state.phase === 'locked'
        ? { ...state, heard: Math.min(state.heard + 1, HERO_WORDS.length) }
        : state;
    case 'finish':
      return state.phase === 'tapWait' || state.phase === 'locked' ? finish(state) : state;
    case 'polished':
      return state.phase === 'polishing' ? { ...state, phase: 'pasted' } : state;
  }
}

function usePhaseTimers(state: DemoState, dispatch: (action: Action) => void) {
  const { phase, heard } = state;
  const streaming = phase === 'listening' || phase === 'locked';
  const allHeard = heard >= HERO_WORDS.length;

  useEffect(() => {
    if (!streaming || allHeard) return undefined;
    const id = window.setInterval(() => dispatch({ type: 'word' }), WORD_MS);
    return () => window.clearInterval(id);
  }, [streaming, allHeard, dispatch]);

  useEffect(() => {
    const wait = phase === 'tapWait' ? DOUBLE_PRESS_MS : phase === 'locked' && allHeard ? SILENCE_MS : phase === 'polishing' ? POLISH_MS : 0;
    if (!wait) return undefined;
    const id = window.setTimeout(() => dispatch({ type: phase === 'polishing' ? 'polished' : 'finish' }), wait);
    return () => window.clearTimeout(id);
  }, [phase, allHeard, dispatch]);
}

export function useHoldDemo() {
  const [state, dispatch] = useReducer(demoReducer, INITIAL);
  const autoplay = useRef<number | undefined>(undefined);
  usePhaseTimers(state, dispatch);

  const press = useCallback(() => {
    window.clearTimeout(autoplay.current);
    dispatch({ type: 'press', at: performance.now() });
  }, []);
  const release = useCallback(() => dispatch({ type: 'release', at: performance.now() }), []);

  /** For anyone who cannot hold a key: plays the whole example hands-free. */
  const playExample = useCallback(() => {
    window.clearTimeout(autoplay.current);
    dispatch({ type: 'press', at: performance.now() });
    autoplay.current = window.setTimeout(
      () => dispatch({ type: 'release', at: performance.now() }),
      HERO_WORDS.length * WORD_MS + 500,
    );
  }, []);

  useEffect(() => () => window.clearTimeout(autoplay.current), []);

  return { state, press, release, playExample };
}
