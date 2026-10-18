import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_WINDOW_MS, INITIAL_STATE, reduce, TAP_MAX_MS, wantsEndpointing, type MachineEvent, type MachineState, type Transition,
} from '../../../src/main/voice/machine';
import type { FnKeyEvent } from '../../../src/main/services';

const NO_MODS = { ctrl: false, shift: false, alt: false, cmd: false };
let counter = 0;
const ids = () => {
  counter += 1;
  return { sessionId: `s${counter}`, requestId: `r${counter}` };
};
const fn = (down: boolean, t: number, mods: Partial<FnKeyEvent['mods']> = {}): MachineEvent => ({
  type: 'fn', key: { down, t, mods: { ...NO_MODS, ...mods } }, ids: ids(), now: 1000 + t,
});

/** Runs events in order and returns every transition. */
function run(events: readonly MachineEvent[], start: MachineState = INITIAL_STATE): Transition[] {
  let state = start;
  return events.map((event) => {
    const transition = reduce(state, event);
    state = transition.state;
    return transition;
  });
}
const effectTypes = (transitions: readonly Transition[]) => transitions.flatMap((transition) => transition.effects.map((effect) => effect.type));

describe('voice machine — fn push-to-talk', () => {
  it('starts dictation on fn down and ends it on release after a hold', () => {
    const steps = run([fn(true, 0), fn(false, 900)]);

    expect(steps[0].effects[0]).toMatchObject({ type: 'begin', session: { mode: 'dictate', source: 'fn', endpointing: false, locked: false } });
    expect(steps[1].effects[0]).toMatchObject({ type: 'end' });
    expect(steps[1].state.listening).toBeNull();
  });

  it.each([
    [{ ctrl: true }, 'ask'],
    [{ shift: true }, 'command'],
    [{}, 'dictate'],
  ] as const)('maps modifiers %o to %s', (mods, mode) => {
    const [step] = run([fn(true, 0, mods)]);
    expect(step.effects[0]).toMatchObject({ type: 'begin', session: { mode } });
  });

  it('treats a short press as a tap and schedules the double-tap window', () => {
    const steps = run([fn(true, 0), fn(false, TAP_MAX_MS - 50)]);

    expect(steps[1].effects).toEqual([{ type: 'schedule-tap-timeout', sessionId: steps[0].state.listening?.sessionId, ms: DOUBLE_TAP_WINDOW_MS }]);
    expect(steps[1].state.listening).not.toBeNull();
  });

  it('cancels a single stray tap silently when the window closes', () => {
    const steps = run([fn(true, 0), fn(false, 100)]);
    const sessionId = steps[0].state.listening!.sessionId;

    const timeout = reduce(steps[1].state, { type: 'tap-timeout', sessionId });

    expect(timeout.effects).toEqual([{ type: 'abort', session: steps[0].state.listening, silent: true }]);
    expect(timeout.state.listening).toBeNull();
  });

  it('locks dictation on a double tap and stops on the next press', () => {
    const steps = run([fn(true, 0), fn(false, 100), fn(true, 300), fn(false, 380), fn(true, 5000), fn(false, 5100)]);

    expect(steps[2].effects[0]).toMatchObject({ type: 'restart', previousRequestId: steps[0].state.listening!.requestId, session: { locked: true, endpointing: true } });
    expect(steps[3].effects).toEqual([]); // releasing the second tap does not stop a locked session
    expect(steps[4].effects[0]).toMatchObject({ type: 'end', session: { locked: true } });
    expect(steps[5].effects).toEqual([]);
    expect(steps[5].state.listening).toBeNull();
  });

  it('ignores the tap timeout once the session is locked', () => {
    const steps = run([fn(true, 0), fn(false, 100), fn(true, 300)]);
    const timeout = reduce(steps[2].state, { type: 'tap-timeout', sessionId: steps[0].state.listening!.sessionId });
    expect(timeout.effects).toEqual([]);
  });

  it('does not lock when the second press comes too late', () => {
    const steps = run([fn(true, 0), fn(false, 100), fn(true, 100 + DOUBLE_TAP_WINDOW_MS + 50)]);
    expect(steps[2].effects[0]).toMatchObject({ type: 'end' });
  });

  it('a fn press stops a hands-free session started elsewhere', () => {
    const [started] = run([{ type: 'start', mode: 'command', source: 'clap', ids: ids(), now: 0 }]);
    const steps = run([fn(true, 10), fn(false, 900)], started.state);
    expect(effectTypes(steps)).toEqual(['end']);
  });

  it('ignores repeated downs without an up', () => {
    const steps = run([fn(true, 0), fn(true, 50)]);
    expect(steps[1].effects).toEqual([]);
  });
});

describe('voice machine — start / stop / cancel', () => {
  it('start while listening is a no-op', () => {
    const steps = run([
      { type: 'start', mode: 'command', source: 'hotkey', ids: ids(), now: 0 },
      { type: 'start', mode: 'dictate', source: 'leafy', ids: ids(), now: 1 },
    ]);
    expect(effectTypes(steps)).toEqual(['begin']);
    expect(steps[1].state.listening?.mode).toBe('command');
  });

  it('stop ends the capture; a later start begins a new session (queueing is the orchestrator’s job)', () => {
    const steps = run([
      { type: 'start', mode: 'dictate', source: 'hotkey', ids: ids(), now: 0 },
      { type: 'stop' },
      { type: 'start', mode: 'dictate', source: 'hotkey', ids: ids(), now: 2 },
    ]);
    expect(effectTypes(steps)).toEqual(['begin', 'end', 'begin']);
  });

  it('cancel aborts loudly and resets fn tracking', () => {
    const steps = run([fn(true, 0), { type: 'cancel' }, fn(false, 500)]);
    expect(steps[1].effects[0]).toMatchObject({ type: 'abort', silent: false });
    expect(steps[2].effects).toEqual([]);
  });

  it('stop and cancel do nothing when idle', () => {
    expect(effectTypes(run([{ type: 'stop' }, { type: 'cancel' }]))).toEqual([]);
  });

  it('clears listening when the engine ends a capture on its own', () => {
    const [started] = run([{ type: 'start', mode: 'command', source: 'clap', ids: ids(), now: 0 }]);
    const ended = reduce(started.state, { type: 'capture-ended', requestId: started.state.listening!.requestId });
    expect(ended.state.listening).toBeNull();
    expect(reduce(started.state, { type: 'capture-ended', requestId: 'other' }).state).toBe(started.state);
  });
});

describe('wantsEndpointing', () => {
  it.each([
    ['dictate', 'fn', false, false], ['command', 'fn', false, false], ['dictate', 'fn', true, true],
    ['command', 'hotkey', false, true], ['dictate', 'hotkey', false, false], ['command', 'clap', false, true],
    ['dictate', 'leafy', false, true], ['command', 'palette', false, true], ['dictate', 'tray', false, true],
  ] as const)('%s from %s (locked %s) → %s', (mode, source, locked, expected) => {
    expect(wantsEndpointing(mode, source, locked)).toBe(expected);
  });
});
