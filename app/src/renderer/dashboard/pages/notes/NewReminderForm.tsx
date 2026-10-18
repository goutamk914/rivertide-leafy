import { useRef, useState, type FormEvent } from 'react';
import { Bell } from 'lucide-react';
import { formatDateTime } from '../../../lib/format';
import { errorMessage, invoke } from '../../../lib/ipc';
import { Button, Card, Field, SegmentedControl, Select, TextInput, Toggle, toast } from '../../../ui/components';
import { MINUTE_CHOICES, resolveWhen, validateReminderText, type WhenChoice } from './when';

type WhenKind = WhenChoice['kind'];
const DEFAULT_TIME = '09:00';

const WHEN_OPTIONS = [
  { value: 'in', label: 'In a while' },
  { value: 'at', label: 'At a time' },
  { value: 'tomorrow', label: 'Tomorrow' },
] as const;

function minutesLabel(m: number): string {
  return m < 60 ? `In ${m} minutes` : m === 60 ? 'In 1 hour' : `In ${m / 60} hours`;
}

export function NewReminderForm({ now }: { readonly now: Date }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<WhenKind>('in');
  const [minutes, setMinutes] = useState('15');
  const [time, setTime] = useState(DEFAULT_TIME);
  const [daily, setDaily] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [whenError, setWhenError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  const choice: WhenChoice = kind === 'in' ? { kind, minutes: Number(minutes) } : { kind, time };
  const preview = resolveWhen(choice, now);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateReminderText(text);
    setTextError(problem);
    const when = resolveWhen(choice, new Date());
    setWhenError(when.ok ? null : when.error);
    if (problem) return textRef.current?.focus();
    if (!when.ok) return timeRef.current?.focus();
    setSaving(true);
    try {
      const reminder = await invoke('reminders:create', {
        kind: 'reminder',
        text: text.trim(),
        ...(when.inMinutes !== undefined ? { inMinutes: when.inMinutes } : {}),
        ...(when.dueAt ? { dueAt: when.dueAt } : {}),
        repeat: daily ? 'daily' : 'none',
      });
      toast.success(`Reminder set for ${formatDateTime(reminder.dueAt)}.`);
      setText('');
    } catch (err) {
      setWhenError(`The reminder wasn’t set. ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="new-reminder">
      <h2 id="new-reminder" className="rt-section-head__title" style={{ marginBottom: 16 }}>New reminder</h2>
      <form className="reminder-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Remind me to" error={textError}>
          <TextInput ref={textRef} value={text} maxLength={300} placeholder="Take my evening medicines" onChange={(e) => setText(e.target.value)} onBlur={() => text && setTextError(validateReminderText(text))} />
        </Field>
        <SegmentedControl label="When" block options={WHEN_OPTIONS} value={kind} onChange={setKind} />
        {kind === 'in' ? (
          <Field label="How long from now">
            <Select value={minutes} onChange={setMinutes} options={MINUTE_CHOICES.map((m) => ({ value: String(m), label: minutesLabel(m) }))} />
          </Field>
        ) : (
          <Field label={kind === 'tomorrow' ? 'Time tomorrow' : 'Time'} error={whenError} help={preview.ok && preview.rolledToTomorrow ? 'That time has passed today, so it will be tomorrow.' : ' '}>
            <TextInput ref={timeRef} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        )}
        {kind === 'in' && whenError ? <p className="rt-status rt-status--error" role="alert">{whenError}</p> : null}
        <Toggle label="Every day" description="Repeat at the same time each day." checked={daily} onChange={setDaily} />
        <Button type="submit" variant="accent" icon={Bell} loading={saving}>Set reminder</Button>
      </form>
    </Card>
  );
}
