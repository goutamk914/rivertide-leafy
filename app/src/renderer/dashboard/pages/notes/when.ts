/** Turns the "New reminder" form's choice into the `reminders:create` timing fields. Pure; unit-tested. */

export type WhenChoice =
  | { readonly kind: 'in'; readonly minutes: number }
  | { readonly kind: 'at'; readonly time: string }
  | { readonly kind: 'tomorrow'; readonly time: string };

export type WhenResult =
  | { readonly ok: true; readonly inMinutes?: number; readonly dueAt?: string; readonly rolledToTomorrow: boolean }
  | { readonly ok: false; readonly error: string };

export const MINUTE_CHOICES = [5, 10, 15, 30, 60, 120] as const;
const MAX_MINUTES = 60 * 24 * 365;

/** Parses "HH:MM" (24-hour, as <input type="time"> gives it). */
export function parseTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function atLocal(base: Date, dayOffset: number, hours: number, minutes: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hours, minutes, 0, 0);
}

export function resolveWhen(choice: WhenChoice, now: Date): WhenResult {
  if (choice.kind === 'in') {
    if (!Number.isFinite(choice.minutes) || choice.minutes <= 0 || choice.minutes > MAX_MINUTES) {
      return { ok: false, error: 'Choose how many minutes from now.' };
    }
    return { ok: true, inMinutes: choice.minutes, rolledToTomorrow: false };
  }
  const time = parseTime(choice.time);
  if (!time) return { ok: false, error: 'Enter a time, like 8:30 PM.' };
  if (choice.kind === 'tomorrow') {
    return { ok: true, dueAt: atLocal(now, 1, time.hours, time.minutes).toISOString(), rolledToTomorrow: false };
  }
  const today = atLocal(now, 0, time.hours, time.minutes);
  const rolled = today.getTime() <= now.getTime();
  const due = rolled ? atLocal(now, 1, time.hours, time.minutes) : today;
  return { ok: true, dueAt: due.toISOString(), rolledToTomorrow: rolled };
}

export function validateReminderText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Say what the reminder is for.';
  if (trimmed.length > 300) return 'Keep it under 300 characters.';
  return null;
}
