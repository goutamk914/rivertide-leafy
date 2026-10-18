/**
 * Pure voice-capture state machine (no Electron, no timers, no I/O).
 *
 * It owns the *listening* lifecycle and fn-key gestures and answers every event with a new state
 * plus effects for the orchestrator to perform:
 *  - fn hold → record while held (ctrl → ask, shift → command, else dictate)
 *  - a press shorter than 250 ms is a tap; a second press within 450 ms locks dictation
 *    (hands-free, endpointed; the next fn press stops it); a single stray tap cancels silently
 *  - start while listening is a no-op; start while earlier sessions are still processing is fine
 */
import type { Id, VoiceMode, VoiceSource } from '../../shared/types';
import type { FnKeyEvent } from '../services';

export const TAP_MAX_MS = 250;
export const DOUBLE_TAP_WINDOW_MS = 450;

export interface ListeningSession {
  readonly sessionId: Id;
  /** Engine capture id; changes when a tap-lock restarts the capture with endpointing. */
  readonly requestId: Id;
  readonly mode: VoiceMode;
  readonly source: VoiceSource;
  readonly locked: boolean;
  readonly endpointing: boolean;
  readonly startedAt: number;
}

export interface FnState {
  /** Helper timestamp of the current press, null when fn is up. */
  readonly downAt: number | null;
  /** This press already did its job (stopped/locked a session): ignore its release. */
  readonly consumed: boolean;
  /** Session started by a quick tap, waiting to see if a second press locks it. */
  readonly tapSessionId: Id | null;
  readonly lastTapUpAt: number | null;
}

export interface MachineState {
  readonly listening: ListeningSession | null;
  readonly fn: FnState;
}

export const INITIAL_STATE: MachineState = {
  listening: null,
  fn: { downAt: null, consumed: false, tapSessionId: null, lastTapUpAt: null },
};

/** Fresh ids are passed in so the reducer stays pure. */
export interface NewIds { readonly sessionId: Id; readonly requestId: Id }

export type MachineEvent =
  | { readonly type: 'start'; readonly mode: VoiceMode; readonly source: VoiceSource; readonly ids: NewIds; readonly now: number }
  | { readonly type: 'stop' }
  | { readonly type: 'cancel' }
  | { readonly type: 'fn'; readonly key: FnKeyEvent; readonly ids: NewIds; readonly now: number }
  | { readonly type: 'tap-timeout'; readonly sessionId: Id }
  /** The engine finished a capture on its own (endpoint, max duration, error). */
  | { readonly type: 'capture-ended'; readonly requestId: Id };

export type MachineEffect =
  | { readonly type: 'begin'; readonly session: ListeningSession }
  /** Double-tap lock: cancel the push-to-talk capture and start an endpointed one. */
  | { readonly type: 'restart'; readonly session: ListeningSession; readonly previousRequestId: Id }
  | { readonly type: 'end'; readonly session: ListeningSession }
  | { readonly type: 'abort'; readonly session: ListeningSession; readonly silent: boolean }
  | { readonly type: 'schedule-tap-timeout'; readonly sessionId: Id; readonly ms: number };

export interface Transition {
  readonly state: MachineState;
  readonly effects: readonly MachineEffect[];
}

const HANDS_FREE_SOURCES: ReadonlySet<VoiceSource> = new Set(['clap', 'wake', 'leafy', 'palette', 'tray', 'dashboard']);

/** Endpointing (auto-stop on silence) for hands-free starts; never for fn push-to-talk. */
export function wantsEndpointing(mode: VoiceMode, source: VoiceSource, locked: boolean): boolean {
  if (locked) return true;
  if (source === 'fn') return false;
  if (source === 'hotkey') return mode === 'command';
  return HANDS_FREE_SOURCES.has(source);
}

export function modeForMods(mods: FnKeyEvent['mods']): VoiceMode {
  if (mods.ctrl) return 'ask';
  if (mods.shift) return 'command';
  return 'dictate';
}

const unchanged = (state: MachineState): Transition => ({ state, effects: [] });
const resetFn = (fn: FnState): FnState => ({ ...fn, downAt: null, consumed: false });

function newSession(mode: VoiceMode, source: VoiceSource, ids: NewIds, now: number): ListeningSession {
  return { ...ids, mode, source, locked: false, endpointing: wantsEndpointing(mode, source, false), startedAt: now };
}

function fnDown(state: MachineState, key: FnKeyEvent, ids: NewIds, now: number): Transition {
  const { listening, fn } = state;
  if (fn.downAt !== null) return unchanged(state); // repeated down without an up
  const pressed: FnState = { ...fn, downAt: key.t, consumed: true };
  const isTapPending = listening !== null && fn.tapSessionId === listening.sessionId && fn.lastTapUpAt !== null;
  if (listening && isTapPending && key.t - (fn.lastTapUpAt ?? 0) <= DOUBLE_TAP_WINDOW_MS && !listening.locked) {
    const locked: ListeningSession = { ...listening, requestId: ids.requestId, locked: true, endpointing: true };
    return {
      state: { listening: locked, fn: { ...pressed, tapSessionId: null, lastTapUpAt: null } },
      effects: [{ type: 'restart', session: locked, previousRequestId: listening.requestId }],
    };
  }
  if (listening) {
    // Hands-free (locked, hotkey, clap…) or an expired tap: this press finishes it.
    return { state: { listening: null, fn: { ...pressed, tapSessionId: null } }, effects: [{ type: 'end', session: listening }] };
  }
  const session = newSession(modeForMods(key.mods), 'fn', ids, now);
  return { state: { listening: session, fn: { ...pressed, consumed: false, tapSessionId: null } }, effects: [{ type: 'begin', session }] };
}

function fnUp(state: MachineState, key: FnKeyEvent): Transition {
  const { listening, fn } = state;
  if (fn.downAt === null || fn.consumed || !listening || listening.source !== 'fn' || listening.locked) {
    return unchanged({ ...state, fn: resetFn(fn) });
  }
  if (key.t - fn.downAt < TAP_MAX_MS) {
    return {
      state: { ...state, fn: { ...resetFn(fn), tapSessionId: listening.sessionId, lastTapUpAt: key.t } },
      effects: [{ type: 'schedule-tap-timeout', sessionId: listening.sessionId, ms: DOUBLE_TAP_WINDOW_MS }],
    };
  }
  return { state: { listening: null, fn: resetFn(fn) }, effects: [{ type: 'end', session: listening }] };
}

export function reduce(state: MachineState, event: MachineEvent): Transition {
  switch (event.type) {
    case 'start': {
      if (state.listening) return unchanged(state);
      const session = newSession(event.mode, event.source, event.ids, event.now);
      return { state: { ...state, listening: session }, effects: [{ type: 'begin', session }] };
    }
    case 'stop':
      return state.listening
        ? { state: { listening: null, fn: { ...state.fn, tapSessionId: null } }, effects: [{ type: 'end', session: state.listening }] }
        : unchanged(state);
    case 'cancel':
      return state.listening
        ? { state: INITIAL_STATE, effects: [{ type: 'abort', session: state.listening, silent: false }] }
        : unchanged({ ...state, fn: INITIAL_STATE.fn });
    case 'fn':
      return event.key.down ? fnDown(state, event.key, event.ids, event.now) : fnUp(state, event.key);
    case 'tap-timeout': {
      const { listening, fn } = state;
      if (!listening || fn.tapSessionId !== event.sessionId || listening.sessionId !== event.sessionId || listening.locked) return unchanged(state);
      return { state: { listening: null, fn: { ...fn, tapSessionId: null, lastTapUpAt: null } }, effects: [{ type: 'abort', session: listening, silent: true }] };
    }
    case 'capture-ended':
      return state.listening?.requestId === event.requestId
        ? unchanged({ listening: null, fn: { ...state.fn, tapSessionId: null } })
        : unchanged(state);
  }
}
