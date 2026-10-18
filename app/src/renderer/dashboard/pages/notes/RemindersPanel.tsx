import { useCallback, useMemo } from 'react';
import { Bell, Timer } from 'lucide-react';
import type { Reminder } from '@shared/types';
import { formatDateTime, formatRelative } from '../../../lib/format';
import { invoke } from '../../../lib/ipc';
import { Badge, Button, Card, ICON_STROKE, SkeletonList, cx } from '../../../ui/components';
import { useIpcQuery, useNow } from '../../hooks/useIpc';
import { useUndoableDelete } from '../../hooks/useUndoableDelete';
import { byDataId, focusSoon, neighbourOf } from '../../lib/focus';
import { PageError } from '../../shell/Page';
import { NewReminderForm } from './NewReminderForm';

const PAST_LIMIT = 20;
const REMINDER_ID_ATTR = 'data-reminder-id';
const UPCOMING_TITLE_ID = 'upcoming-title';
const STATUS_LABEL: Readonly<Record<Reminder['status'], string>> = { scheduled: 'Scheduled', fired: 'Done', cancelled: 'Cancelled', missed: 'Missed' };

/** Splits reminders into upcoming (soonest first) and past (latest first). Exported for tests. */
export function splitReminders(reminders: readonly Reminder[], now: Date): { upcoming: Reminder[]; past: Reminder[] } {
  const isUpcoming = (r: Reminder) => r.status === 'scheduled' && Date.parse(r.dueAt) >= now.getTime();
  return {
    upcoming: reminders.filter(isUpcoming).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    past: reminders.filter((r) => !isUpcoming(r)).sort((a, b) => b.dueAt.localeCompare(a.dueAt)).slice(0, PAST_LIMIT),
  };
}

function ReminderRow({ reminder, now, onCancel }: { readonly reminder: Reminder; readonly now: Date; readonly onCancel?: () => void }) {
  const Icon = reminder.kind === 'timer' ? Timer : Bell;
  return (
    <li className={cx('reminder-row', !onCancel && 'reminder-row--past')}>
      <Icon size={18} strokeWidth={ICON_STROKE} aria-label={reminder.kind === 'timer' ? 'Timer' : 'Reminder'} />
      <span className="reminder-row__text">
        {reminder.text}
        <span className="reminder-row__when">
          {formatDateTime(reminder.dueAt, now)} · {formatRelative(reminder.dueAt, now)}
          {reminder.repeat === 'daily' ? ' · every day' : ''}
        </span>
      </span>
      {onCancel ? (
        <Button size="sm" variant="quiet" aria-label={`Cancel “${reminder.text}”`} onClick={onCancel} {...{ [REMINDER_ID_ATTR]: reminder.id }}>Cancel</Button>
      ) : <Badge tone={reminder.status === 'missed' ? 'warn' : 'neutral'}>{STATUS_LABEL[reminder.status]}</Badge>}
    </li>
  );
}

export function RemindersPanel({ calm }: { readonly calm: boolean }) {
  const now = useNow(30_000);
  const list = useIpcQuery(() => invoke('reminders:list', undefined), [], ['reminders']);
  const removal = useUndoableDelete(useCallback((id: string) => invoke('reminders:cancel', { id }), []));
  const { upcoming, past } = useMemo(
    () => splitReminders((list.data ?? []).filter((r) => !removal.hidden.has(r.id)), now),
    [list.data, removal.hidden, now],
  );

  const cancel = (reminder: Reminder) => {
    const next = neighbourOf(upcoming, reminder.id);
    removal.remove(reminder.id, `Cancelled “${reminder.text}”.`);
    focusSoon(...(next ? [byDataId(REMINDER_ID_ATTR, next.id)] : []), `#${UPCOMING_TITLE_ID}`);
  };

  return (
    <div className="reminders">
      <Card as="section" aria-labelledby="upcoming-title">
        <h2 id={UPCOMING_TITLE_ID} tabIndex={-1} className="rt-section-head__title" style={{ marginBottom: 12 }}>Coming up</h2>
        {list.error ? <PageError message={list.error} onRetry={list.reload} /> : null}
        {list.loading ? <SkeletonList rows={3} label="Loading reminders" /> : (
          <ul className="reminder-list">
            {upcoming.length === 0 ? <li className="muted">Nothing scheduled. Add one here, or say “remind me…” to Leafy.</li> : null}
            {upcoming.map((r) => (
              <ReminderRow key={r.id} reminder={r} now={now} onCancel={() => cancel(r)} />
            ))}
          </ul>
        )}
        {calm || past.length === 0 ? null : (
          <>
            <h2 className="rt-section-head__title" style={{ margin: '24px 0 12px' }}>Earlier</h2>
            <ul className="reminder-list">
              {past.map((r) => <ReminderRow key={r.id} reminder={r} now={now} />)}
            </ul>
          </>
        )}
      </Card>
      <NewReminderForm now={now} />
    </div>
  );
}
