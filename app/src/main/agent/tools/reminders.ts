/** Timer and reminder tools: set_timer, create_reminder, list_reminders, cancel_reminder. */
import { z } from 'zod';
import type { Reminder } from '../../../shared/types';
import { humanTime } from '../../ai/prompts/clock';
import { clip, defineTool, fail, ok, plural } from './types';

const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const PAST_TOLERANCE_MS = 60_000;
const LIST_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "30 seconds", "10 minutes", "1 hour and 30 minutes". */
export function describeMinutes(minutes: number): string {
  if (minutes < 1) return plural(Math.round(minutes * 60), 'second');
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return plural(rest, 'minute');
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} and ${plural(rest, 'minute')}`;
}

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "at 3:00 PM", "tomorrow at 9:00 AM", "on Friday at 9:00 AM", "on 20 October at 9:00 AM". */
export function describeWhen(when: Date, now: Date): string {
  const days = Math.round((startOfDay(when) - startOfDay(now)) / DAY_MS);
  const time = humanTime(when);
  if (days === 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `on ${when.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
  return `on ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} at ${time}`;
}

export const setTimerTool = defineTool({
  name: 'set_timer',
  description: 'Start a countdown timer. Rivertide shows a notification and plays a sound when it ends.',
  risk: 'act',
  schema: z.object({
    minutes: z.number().min(0.1).max(1440).describe('Length in minutes (0.5 = 30 seconds).'),
    label: z.string().trim().max(80).optional().describe('Optional name, e.g. "pasta".'),
  }),
  title: ({ minutes }) => `Timer for ${describeMinutes(minutes)}`,
  async run({ minutes, label }, context) {
    const reminder = context.app.reminders.create({ kind: 'timer', text: label?.trim() || 'Timer', inMinutes: minutes });
    const name = label?.trim() ? ` for ${label.trim()}` : '';
    return ok(`Timer set${name}: ${describeMinutes(minutes)}.`, { id: reminder.id, dueAt: reminder.dueAt });
  },
});

export const createReminderTool = defineTool({
  name: 'create_reminder',
  description: 'Remind the person about something at a specific time (notification + sound). Convert spoken times to an exact ISO-8601 time using the current time from the context message.',
  risk: 'act',
  schema: z.object({
    text: z.string().trim().min(1).max(300).describe('What to remind them about, in their words, e.g. "take my evening pills".'),
    dueAt: z.string().trim().min(10).max(40).describe('Exact local time as ISO-8601 with offset, e.g. 2026-10-15T20:00:00-07:00.'),
    repeat: z.enum(['none', 'daily']).optional(),
  }),
  title: ({ text }) => `Remind: ${clip(text, 40)}`,
  async run({ text, dueAt, repeat }, context) {
    const when = new Date(dueAt);
    const now = context.now();
    if (Number.isNaN(when.getTime())) return fail('I didn’t understand that time. When should I remind you?');
    if (when.getTime() < now.getTime() - PAST_TOLERANCE_MS) return fail('That time has already passed. When should I remind you?');
    if (when.getTime() > now.getTime() + MAX_AHEAD_MS) return fail('I can only set reminders up to a year ahead.');
    const reminder = context.app.reminders.create({ kind: 'reminder', text, dueAt: when.toISOString(), repeat: repeat ?? 'none' });
    const daily = repeat === 'daily' ? ' every day' : '';
    return ok(`I’ll remind you to ${text.replace(/^to\s+/i, '')} ${describeWhen(when, now)}${daily}.`, { id: reminder.id, dueAt: reminder.dueAt });
  },
});

const upcoming = (reminders: readonly Reminder[]): Reminder[] =>
  reminders.filter((reminder) => reminder.status === 'scheduled').sort((a, b) => a.dueAt.localeCompare(b.dueAt));

export const listRemindersTool = defineTool({
  name: 'list_reminders',
  description: 'List upcoming reminders and running timers (with ids for cancel_reminder).',
  risk: 'read',
  schema: z.object({}),
  title: () => 'Check reminders',
  async run(_input, context) {
    const items = upcoming(context.app.reminders.list()).slice(0, LIST_LIMIT);
    const now = context.now();
    if (items.length === 0) return ok('You don’t have any reminders or timers coming up.', { reminders: [] });
    const spoken = items.slice(0, 3).map((item) => `${item.kind === 'timer' ? `the ${item.text.toLowerCase()} timer` : item.text} ${describeWhen(new Date(item.dueAt), now)}`);
    const more = items.length > 3 ? `, and ${items.length - 3} more` : '';
    return ok(`You have ${plural(items.length, 'reminder')}: ${spoken.join('; ')}${more}.`, {
      reminders: items.map((item) => ({ id: item.id, kind: item.kind, text: item.text, dueAt: item.dueAt, repeat: item.repeat })),
    });
  },
});

export const cancelReminderTool = defineTool({
  name: 'cancel_reminder',
  description: 'Cancel a reminder or timer by id (get ids from list_reminders). The person is asked to confirm first.',
  risk: 'confirm',
  schema: z.object({ id: z.string().trim().min(1).max(64) }),
  title: () => 'Cancel a reminder',
  confirmText: () => 'Cancel this reminder? It won’t go off.',
  async run({ id }, context) {
    const reminder = context.app.reminders.list().find((item) => item.id === id && item.status === 'scheduled');
    if (!reminder) return fail('I couldn’t find that reminder. It may have already gone off.');
    context.app.reminders.cancel(id);
    return ok(reminder.kind === 'timer' ? 'Timer cancelled.' : `Cancelled the reminder to ${reminder.text}.`);
  },
});
