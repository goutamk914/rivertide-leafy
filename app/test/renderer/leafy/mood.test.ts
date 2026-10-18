import { describe, expect, it } from 'vitest';
import {
  chooseMood,
  isNight,
  moodCandidates,
  phaseMood,
  rememberSettled,
  SLEEP_AFTER_MS,
  YAWN_AFTER_MS,
  YAWN_EVERY_MS,
  yawnPeriod,
  type MoodInput,
} from '../../../src/renderer/leafy/mood';

const base: MoodInput = {
  phase: 'idle',
  mode: null,
  sessionId: 's1',
  pasted: false,
  errorCode: null,
  toolActivity: null,
  drag: null,
  dropSeq: 0,
  cue: null,
  greeting: false,
  idleMs: 0,
  hour: 14,
  sleepAtNight: true,
};

const none: ReadonlySet<string> = new Set();
const pick = (patch: Partial<MoodInput>, settled = none) => chooseMood({ ...base, ...patch }, settled);

describe('phaseMood', () => {
  it.each([
    [{ phase: 'listening' }, 'listening'],
    [{ phase: 'transcribing' }, 'thinking'],
    [{ phase: 'thinking' }, 'thinking'],
    [{ phase: 'acting' }, 'working'],
    [{ phase: 'acting', toolActivity: 'searching' }, 'searching'],
    [{ phase: 'confirming' }, 'confirm'],
    [{ phase: 'speaking' }, 'speaking'],
    [{ phase: 'done', mode: 'dictate', pasted: true }, 'writing'],
    [{ phase: 'done', mode: 'dictate', pasted: false }, 'success'],
    [{ phase: 'done', mode: 'command', pasted: true }, 'success'],
    [{ phase: 'error', errorCode: 'stt-failed' }, 'error'],
    [{ phase: 'error', errorCode: 'no-speech' }, 'caring'],
    [{ phase: 'error', errorCode: 'cancelled' }, null],
    [{ phase: 'idle' }, null],
  ] as const)('maps %o to %s', (patch, mood) => {
    expect(phaseMood({ ...base, ...patch })).toBe(mood);
  });
});

describe('chooseMood', () => {
  it('rests in idle with nothing going on', () => {
    expect(pick({})).toEqual({ mood: 'idle', key: 'idle' });
  });

  it('puts dragging above everything, even a live session', () => {
    expect(pick({ drag: 'dragging', phase: 'listening' }).mood).toBe('dragging');
  });

  it('plays the landing once per drop', () => {
    const landing = pick({ drag: 'dropped', dropSeq: 2 });
    const settled = rememberSettled(none, landing.key);

    expect(landing).toEqual({ mood: 'dropped', key: 'drop:2' });
    expect(pick({ drag: 'dropped', dropSeq: 2 }, settled).mood).toBe('idle');
    expect(pick({ drag: 'dropped', dropSeq: 3 }, settled).mood).toBe('dropped');
  });

  it('lets a live voice phase win over a cue', () => {
    expect(pick({ phase: 'thinking', cue: { mood: 'notify', seq: 1 } }).mood).toBe('thinking');
  });

  it('falls through to a cue once the phase one-shot has settled', () => {
    const success = pick({ phase: 'done', mode: 'command' });
    const settled = rememberSettled(none, success.key);

    const next = pick({ phase: 'done', mode: 'command', cue: { mood: 'celebrate', seq: 4 } }, settled);

    expect(success.mood).toBe('success');
    expect(next).toEqual({ mood: 'celebrate', key: 'cue:4' });
  });

  it('keeps looping moods even if their key was marked settled', () => {
    const listening = pick({ phase: 'listening' });

    expect(pick({ phase: 'listening' }, rememberSettled(none, listening.key)).mood).toBe('listening');
  });

  it('keys acting by activity so switching tools changes the pose', () => {
    expect(pick({ phase: 'acting', toolActivity: 'searching' }).key).not.toBe(pick({ phase: 'acting', toolActivity: 'working' }).key);
  });

  it('greets once on first show', () => {
    const greeting = pick({ greeting: true });

    expect(greeting.mood).toBe('greeting');
    expect(pick({ greeting: true }, rememberSettled(none, greeting.key)).mood).toBe('idle');
  });

  it('yawns once per period after three idle minutes', () => {
    const first = pick({ idleMs: YAWN_AFTER_MS + 10 });
    const settled = rememberSettled(none, first.key);

    expect(first).toEqual({ mood: 'yawning', key: 'yawn:0' });
    expect(pick({ idleMs: YAWN_AFTER_MS + 20 }, settled).mood).toBe('idle');
    expect(pick({ idleMs: YAWN_AFTER_MS + YAWN_EVERY_MS + 1 }, settled).key).toBe('yawn:1');
  });

  it('sleeps after ten idle minutes at night, only when allowed', () => {
    expect(pick({ idleMs: SLEEP_AFTER_MS, hour: 23 }).mood).toBe('sleeping');
    expect(pick({ idleMs: SLEEP_AFTER_MS, hour: 3 }).mood).toBe('sleeping');
    expect(pick({ idleMs: SLEEP_AFTER_MS, hour: 15 }).mood).toBe('yawning');
    expect(pick({ idleMs: SLEEP_AFTER_MS, hour: 23, sleepAtNight: false }).mood).toBe('yawning');
  });

  it('does not idle-yawn during a session', () => {
    const candidates = moodCandidates({ ...base, phase: 'speaking', idleMs: SLEEP_AFTER_MS * 2 });

    expect(candidates.map((c) => c.mood)).toEqual(['speaking', 'idle']);
  });
});

describe('time helpers', () => {
  it('knows the night window', () => {
    expect(isNight(22)).toBe(true);
    expect(isNight(6)).toBe(true);
    expect(isNight(7)).toBe(false);
    expect(isNight(21)).toBe(false);
  });

  it('numbers yawn periods', () => {
    expect(yawnPeriod(0)).toBeNull();
    expect(yawnPeriod(YAWN_AFTER_MS)).toBe(0);
    expect(yawnPeriod(YAWN_AFTER_MS + YAWN_EVERY_MS * 2)).toBe(2);
  });

  it('keeps the settled set bounded and immutable', () => {
    const one = rememberSettled(none, 'a');
    const many = Array.from({ length: 30 }, (_, i) => `k${i}`).reduce((set, key) => rememberSettled(set, key), one);

    expect(none.size).toBe(0);
    expect(rememberSettled(one, 'a')).toBe(one);
    expect(many.size).toBe(24);
    expect(many.has('a')).toBe(false);
  });
});
