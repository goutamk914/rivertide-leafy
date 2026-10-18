/**
 * Pure reminder scheduling rules: due-time resolution, missed detection (> 5 min overdue, e.g.
 * the computer was asleep), daily rollover, ordering and pruning of finished items.
 */
import type { Reminder } from '../../shared/types';

export const MISSED_AFTER_MS = 5 * 60 * 1000;
/** A due time this far in the past still counts as "now" (clock skew, slow typing). */
export const PAST_GRACE_MS = 60 * 1000;
export const FINISHED_KEEP = 500;
export const DAY_MS = 24 * 60 * 60 * 1000;

export class ReminderInputError extends Error {
  override readonly name = 'ReminderInputError';
}

export function resolveDueAt(input: { readonly dueAt?: string; readonly inMinutes?: number }, now: number): number {
  const due = input.dueAt !== undefined ? Date.parse(input.dueAt) : now + (input.inMinutes ?? Number.NaN) * 60_000;
  if (!Number.isFinite(due)) throw new ReminderInputError("That time doesn't look right. Please try again.");
  if (due < now - PAST_GRACE_MS) throw new ReminderInputError('That time has already passed. Pick a time later than now.');
  return Math.max(due, now);
}

/**
 * The first daily occurrence of `dueAt` that is strictly after `now`. Steps in local calendar
 * days, so a 9:00 reminder stays at 9:00 across daylight-saving changes.
 */
export function nextDailyOccurrence(dueAt: string, now: number): string {
  const next = new Date(dueAt);
  const behindDays = Math.floor((now - next.getTime()) / DAY_MS) - 1;
  if (behindDays > 0) next.setDate(next.getDate() + behindDays);
  do {
    next.setDate(next.getDate() + 1);
  } while (next.getTime() <= now);
  return next.toISOString();
}

export type DueState = 'future' | 'due' | 'missed';

export function dueState(reminder: Reminder, now: number): DueState {
  const due = Date.parse(reminder.dueAt);
  if (due > now) return 'future';
  return now - due > MISSED_AFTER_MS ? 'missed' : 'due';
}

export function nextDueMs(reminders: readonly Reminder[]): number | null {
  let next: number | null = null;
  for (const reminder of reminders) {
    if (reminder.status !== 'scheduled') continue;
    const due = Date.parse(reminder.dueAt);
    if (!Number.isFinite(due)) continue;
    if (next === null || due < next) next = due;
  }
  return next;
}

/** Scheduled soonest first, then finished items newest first. */
export function sortReminders(reminders: readonly Reminder[]): Reminder[] {
  const scheduled = reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const finished = reminders
    .filter((r) => r.status !== 'scheduled')
    .sort((a, b) => (b.firedAt ?? b.dueAt).localeCompare(a.firedAt ?? a.dueAt));
  return [...scheduled, ...finished];
}

/** Keeps every scheduled item and the most recent finished ones. */
export function pruneFinished(reminders: readonly Reminder[], keep: number = FINISHED_KEEP): Reminder[] {
  const sorted = sortReminders(reminders);
  const scheduledCount = sorted.filter((r) => r.status === 'scheduled').length;
  return sorted.slice(0, scheduledCount + keep);
}

export function firedOccurrence(reminder: Reminder, missed: boolean, firedAt: string): Reminder {
  return { ...reminder, status: missed ? 'missed' : 'fired', firedAt };
}

/** What the stored item becomes after it fires: daily items roll forward, others finish. */
export function afterFiring(reminder: Reminder, missed: boolean, now: number): Reminder {
  const firedAt = new Date(now).toISOString();
  if (reminder.repeat === 'daily') return { ...reminder, status: 'scheduled', dueAt: nextDailyOccurrence(reminder.dueAt, now), firedAt };
  return firedOccurrence(reminder, missed, firedAt);
}

export function reminderWording(reminder: Reminder, missed: boolean): { title: string; body: string; spoken: string } {
  const title = reminder.kind === 'timer' ? 'Timer done' : 'Leafy reminder';
  if (missed) {
    const body = `Missed while your computer was asleep: ${reminder.text}`;
    return { title, body, spoken: body };
  }
  const spoken = reminder.kind === 'timer' ? `Timer done: ${reminder.text}` : `Reminder: ${reminder.text}`;
  return { title, body: reminder.text, spoken };
}
