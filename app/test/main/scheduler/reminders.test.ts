import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reminder } from '../../../src/shared/types';
import { DRIFT_CHECK_MS } from '../../../src/main/scheduler';
import {
  afterFiring, dueState, MISSED_AFTER_MS, nextDailyOccurrence, nextDueMs, pruneFinished, reminderWording, resolveDueAt,
} from '../../../src/main/scheduler/schedule';
import { createFakeContext } from '../data/fake-context';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const MINUTE = 60_000;

const reminder = (overrides: Partial<Reminder>): Reminder => ({
  id: 'r1', kind: 'reminder', text: 'Take anti-nausea pill', dueAt: new Date(NOW).toISOString(), repeat: 'none',
  status: 'scheduled', createdAt: new Date(NOW - MINUTE).toISOString(), firedAt: null, ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('schedule rules', () => {
  it('resolves due times from dueAt or inMinutes and rejects past or invalid times', () => {
    expect(resolveDueAt({ inMinutes: 5 }, NOW)).toBe(NOW + 5 * MINUTE);
    expect(resolveDueAt({ dueAt: new Date(NOW - 30_000).toISOString() }, NOW)).toBe(NOW);
    expect(() => resolveDueAt({ dueAt: new Date(NOW - 5 * MINUTE).toISOString() }, NOW)).toThrow(/already passed/);
    expect(() => resolveDueAt({}, NOW)).toThrow(/doesn't look right/);
  });

  it('classifies due, future and missed (> 5 minutes overdue)', () => {
    expect(dueState(reminder({ dueAt: new Date(NOW + 1).toISOString() }), NOW)).toBe('future');
    expect(dueState(reminder({ dueAt: new Date(NOW - MISSED_AFTER_MS).toISOString() }), NOW)).toBe('due');
    expect(dueState(reminder({ dueAt: new Date(NOW - MISSED_AFTER_MS - 1).toISOString() }), NOW)).toBe('missed');
  });

  it('rolls daily reminders to the next future occurrence', () => {
    const due = '2026-10-12T08:00:00.000Z';
    expect(nextDailyOccurrence(due, NOW)).toBe('2026-10-16T08:00:00.000Z');
    expect(afterFiring(reminder({ repeat: 'daily', dueAt: due }), true, NOW)).toMatchObject({ status: 'scheduled', dueAt: '2026-10-16T08:00:00.000Z' });
    expect(afterFiring(reminder({}), false, NOW)).toMatchObject({ status: 'fired', firedAt: new Date(NOW).toISOString() });
  });

  it('keeps daily reminders at the same local time across a daylight-saving change', () => {
    // Arrange
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const due = new Date(2027, 2, 13, 9, 0).toISOString();
      const now = new Date(2027, 2, 14, 12, 0).getTime();

      // Act
      const next = new Date(nextDailyOccurrence(due, now));

      // Assert
      expect([next.getDate(), next.getHours(), next.getMinutes()]).toEqual([15, 9, 0]);
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it('ignores unparseable due dates instead of spinning the timer', () => {
    expect(nextDueMs([reminder({ dueAt: 'not a date' }), reminder({ id: 'ok', dueAt: new Date(NOW + MINUTE).toISOString() })])).toBe(NOW + MINUTE);
    const { ctx } = createFakeContext({ seed: { reminders: { version: 1, reminders: [reminder({ dueAt: 'garbage', repeat: 'daily' })] } } });
    expect(ctx.reminders.list()).toEqual([]);
  });

  it('words notifications, including the missed-while-asleep case', () => {
    expect(reminderWording(reminder({ kind: 'timer', text: '5-minute timer' }), false)).toEqual({ title: 'Timer done', body: '5-minute timer', spoken: 'Timer done: 5-minute timer' });
    expect(reminderWording(reminder({}), true).body).toBe('Missed while your computer was asleep: Take anti-nausea pill');
  });

  it('finds the next due item and prunes old finished ones', () => {
    const list = [
      reminder({ id: 'a', dueAt: new Date(NOW + 2 * MINUTE).toISOString() }),
      reminder({ id: 'b', dueAt: new Date(NOW + MINUTE).toISOString() }),
      reminder({ id: 'c', status: 'fired', firedAt: new Date(NOW).toISOString() }),
      reminder({ id: 'd', status: 'cancelled' }),
    ];
    expect(nextDueMs(list)).toBe(NOW + MINUTE);
    expect(nextDueMs([])).toBeNull();
    expect(pruneFinished(list, 1).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('reminders service', () => {
  it('fires a timer on time: notification, bus events, Leafy cue, sound and speech', () => {
    // Arrange
    const { ctx, notify, of, windows } = createFakeContext();
    ctx.reminders.start();
    const timer = ctx.reminders.create({ kind: 'timer', text: '5-minute timer', inMinutes: 5, repeat: 'daily' });

    // Act
    vi.advanceTimersByTime(5 * MINUTE - 1);
    const firedEarly = notify.mock.calls.length;
    vi.advanceTimersByTime(1);

    // Assert
    expect(timer.repeat).toBe('none');
    expect(firedEarly).toBe(0);
    expect(notify).toHaveBeenCalledWith('Timer done', '5-minute timer');
    expect(of('reminder:fired')).toEqual([expect.objectContaining({ id: timer.id, status: 'fired' })]);
    expect(of('leafy:cue')).toEqual([{ mood: 'notify', say: '5-minute timer', holdMs: 15_000 }]);
    expect(windows.engine.send).toHaveBeenCalledWith({ type: 'cue', name: 'reminder' });
    expect(windows.engine.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'speak', text: 'Timer done: 5-minute timer' }));
    expect(ctx.reminders.list()[0]).toMatchObject({ id: timer.id, status: 'fired' });
    ctx.reminders.stop();
  });

  it('does not speak when spoken responses are off', () => {
    const { ctx, windows } = createFakeContext({ settings: { voice: { speakResponses: false } } });
    ctx.reminders.start();
    ctx.reminders.create({ kind: 'reminder', text: 'Drink water', inMinutes: 1 });
    vi.advanceTimersByTime(MINUTE);
    expect(windows.engine.send).toHaveBeenCalledTimes(1);
    ctx.reminders.stop();
  });

  it('marks items more than 5 minutes overdue at startup as missed and announces them once', () => {
    // Arrange
    const seed = { reminders: { version: 1, reminders: [
      reminder({ id: 'old', dueAt: new Date(NOW - 60 * MINUTE).toISOString() }),
      reminder({ id: 'recent', dueAt: new Date(NOW - 2 * MINUTE).toISOString(), text: 'Stretch' }),
    ] } };
    const { ctx, notify } = createFakeContext({ seed });

    // Act
    ctx.reminders.start();
    vi.advanceTimersByTime(DRIFT_CHECK_MS * 3);

    // Assert
    expect(notify.mock.calls).toEqual([
      ['Leafy reminder', 'Missed while your computer was asleep: Take anti-nausea pill'],
      ['Leafy reminder', 'Stretch'],
    ]);
    const statuses = Object.fromEntries(ctx.reminders.list().map((r) => [r.id, r.status]));
    expect(statuses).toEqual({ old: 'missed', recent: 'fired' });
    ctx.reminders.stop();
  });

  it('re-schedules daily reminders after they fire', () => {
    // Arrange
    const { ctx, notify } = createFakeContext();
    ctx.reminders.start();
    const daily = ctx.reminders.create({ kind: 'reminder', text: 'Log symptoms', dueAt: new Date(NOW + 10 * MINUTE).toISOString(), repeat: 'daily' });

    // Act
    vi.advanceTimersByTime(10 * MINUTE);
    vi.advanceTimersByTime(24 * 60 * MINUTE);

    // Assert
    expect(notify).toHaveBeenCalledTimes(2);
    const stored = ctx.reminders.list().find((r) => r.id === daily.id);
    expect(stored).toMatchObject({ status: 'scheduled', dueAt: new Date(NOW + 10 * MINUTE + 2 * 24 * 60 * MINUTE).toISOString() });
    ctx.reminders.stop();
  });

  it('catches up through the drift check when the clock jumps (sleep/wake)', () => {
    // Arrange
    const { ctx, notify } = createFakeContext();
    ctx.reminders.start();
    ctx.reminders.create({ kind: 'reminder', text: 'Call pharmacy', inMinutes: 90 });

    // Act: the machine sleeps for two hours; timers did not run, the clock moved on.
    vi.setSystemTime(NOW + 120 * MINUTE);
    vi.advanceTimersByTime(DRIFT_CHECK_MS);

    // Assert
    expect(notify).toHaveBeenCalledWith('Leafy reminder', 'Missed while your computer was asleep: Call pharmacy');
    ctx.reminders.stop();
  });

  it('cancels reminders, validates text, and keeps firing other items when a notification fails', () => {
    // Arrange
    const { ctx, notify, logger, of } = createFakeContext({ notify: () => { throw new Error('no notification center'); } });
    ctx.reminders.start();
    const cancelled = ctx.reminders.create({ kind: 'reminder', text: 'Cancelled one', inMinutes: 1 });
    ctx.reminders.create({ kind: 'reminder', text: 'Kept one', inMinutes: 2 });

    // Act
    ctx.reminders.cancel(cancelled.id);
    ctx.reminders.cancel('unknown');
    vi.advanceTimersByTime(2 * MINUTE);

    // Assert
    expect(() => ctx.reminders.create({ kind: 'reminder', text: '   ', inMinutes: 1 })).toThrow(/what you want/);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(logger.calls.error.length).toBe(1);
    expect(of('reminder:fired').map((r) => r.text)).toEqual(['Kept one']);
    expect(ctx.reminders.list().find((r) => r.id === cancelled.id)?.status).toBe('cancelled');
    ctx.reminders.stop();
  });

  it('does nothing before start and is safe to start twice', () => {
    const { ctx, notify } = createFakeContext();
    ctx.reminders.create({ kind: 'reminder', text: 'Later', inMinutes: 1 });
    vi.advanceTimersByTime(5 * MINUTE);
    expect(notify).not.toHaveBeenCalled();
    ctx.reminders.start();
    ctx.reminders.start();
    expect(notify).toHaveBeenCalledTimes(1);
    ctx.reminders.stop();
  });
});
