/**
 * Reminders and timers. One `setTimeout` is armed for the next due item and re-armed on every
 * change; a 30 s drift check catches timers delayed by sleep. Items more than 5 minutes overdue
 * (at startup or after wake) are marked missed and announced once with that wording.
 */
import { Notification } from 'electron';
import type { Reminder } from '../../shared/types';
import type { AppContext, RemindersService } from '../services';
import { newId, nowIso } from '../data/ids';
import { ReminderSchema } from '../data/schemas';
import { announceChange, errorMessage, lazyLogger, lazyStore, parseItems } from '../data/store';
import {
  afterFiring, dueState, firedOccurrence, nextDueMs, pruneFinished, reminderWording, resolveDueAt, ReminderInputError, sortReminders,
} from './schedule';

interface RemindersFile { readonly version: 1; readonly reminders: readonly Reminder[] }

export const DRIFT_CHECK_MS = 30_000;
/** Long timers are re-armed in steps; Node caps setTimeout at ~24.8 days. */
export const MAX_TIMER_MS = 60 * 60 * 1000;
const CUE_HOLD_MS = 15_000;
const MAX_TEXT = 300;

export interface ReminderDeps {
  readonly notify: (title: string, body: string) => void;
}

export const defaultReminderDeps: ReminderDeps = {
  notify(title, body) {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, silent: false }).show();
  },
};

export function createRemindersService(ctx: AppContext, deps: ReminderDeps = defaultReminderDeps): RemindersService {
  const log = lazyLogger(ctx, 'reminders');
  const store = lazyStore<RemindersFile>(ctx, 'reminders', { version: 1, reminders: [] }, (raw) => ({
    version: 1,
    reminders: parseItems(raw, 'reminders', ReminderSchema, log),
  }));
  let timer: NodeJS.Timeout | null = null;
  let drift: NodeJS.Timeout | null = null;

  const reminders = (): readonly Reminder[] => store().read().reminders;
  const write = (next: readonly Reminder[]): void => {
    store().write({ version: 1, reminders: pruneFinished(next) });
    announceChange(ctx, 'reminders');
  };

  const safely = (what: string, action: () => void): void => {
    try {
      action();
    } catch (error) {
      log().error(`Reminder ${what} failed`, { error: errorMessage(error) });
    }
  };

  const announce = (reminder: Reminder, missed: boolean): void => {
    const wording = reminderWording(reminder, missed);
    const voice = ctx.settings.get().voice;
    safely('notification', () => deps.notify(wording.title, wording.body));
    ctx.bus.emit('reminder:fired', firedOccurrence(reminder, missed, nowIso()));
    ctx.bus.emit('leafy:cue', { mood: 'notify', say: wording.body, holdMs: CUE_HOLD_MS });
    safely('sound', () => ctx.windows.engine.send({ type: 'cue', name: 'reminder' }));
    if (voice.speakResponses) {
      safely('speech', () => ctx.windows.engine.send({ type: 'speak', text: wording.spoken, voiceName: voice.voiceName, rate: voice.speechRate }));
    }
  };

  /** Fires everything that is due; saves first so a failing side effect never re-fires an item. */
  const processDue = (): void => {
    const now = Date.now();
    const due = reminders().filter((r) => r.status === 'scheduled' && dueState(r, now) !== 'future');
    if (due.length === 0) return;
    const updates = new Map(due.map((r) => [r.id, afterFiring(r, dueState(r, now) === 'missed', now)]));
    write(reminders().map((r) => updates.get(r.id) ?? r));
    for (const reminder of due) announce(reminder, dueState(reminder, now) === 'missed');
    log().info('Reminders fired', { count: due.length });
  };

  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!drift) return;
    const next = nextDueMs(reminders());
    if (next === null) return;
    const delay = Math.min(Math.max(0, next - Date.now()), MAX_TIMER_MS);
    timer = setTimeout(tick, delay);
    timer.unref?.();
  };

  const tick = (): void => {
    safely('check', processDue);
    arm();
  };

  return {
    start() {
      if (drift) return;
      drift = setInterval(tick, DRIFT_CHECK_MS);
      drift.unref?.();
      tick();
    },

    stop() {
      if (timer) clearTimeout(timer);
      if (drift) clearInterval(drift);
      timer = null;
      drift = null;
    },

    list: () => sortReminders(reminders()),

    create(input) {
      const text = input.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      if (!text) throw new ReminderInputError('Say or type what you want to be reminded about.');
      const now = Date.now();
      const reminder: Reminder = {
        id: newId(now),
        kind: input.kind,
        text,
        dueAt: new Date(resolveDueAt(input, now)).toISOString(),
        repeat: input.kind === 'timer' ? 'none' : input.repeat ?? 'none',
        status: 'scheduled',
        createdAt: nowIso(now),
        firedAt: null,
      };
      write([...reminders(), reminder]);
      arm();
      return reminder;
    },

    cancel(id) {
      const current = reminders();
      const target = current.find((r) => r.id === id && r.status === 'scheduled');
      if (!target) return;
      write(current.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)));
      arm();
    },
  };
}
