import { useState } from 'react';
import { Mic, NotebookPen, Sprout, Timer } from 'lucide-react';
import type { VoiceMode } from '@shared/types';
import { errorMessage, invoke } from '../../../lib/ipc';
import { navigate } from '../../../lib/router';
import { Button, Dialog, Field, SegmentedControl, TextInput, toast } from '../../../ui/components';

const TIMER_CHOICES = ['5', '10', '20', '30'] as const;
type TimerChoice = (typeof TIMER_CHOICES)[number];

function TimerDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const [minutes, setMinutes] = useState<TimerChoice>('10');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke('reminders:create', { kind: 'timer', text: label.trim() || 'Timer', inMinutes: Number(minutes) });
      toast.success(`Timer set for ${minutes} minutes.`);
      setLabel('');
      onClose();
    } catch (err) {
      setError(`The timer wasn’t set. ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title="Set a timer"
      description="Leafy will let you know when it’s up."
      actions={
        <>
          <Button variant="quiet" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="accent" loading={saving} onClick={() => void start()}>Start timer</Button>
        </>
      }
    >
      <div className="rt-field">
        <span className="rt-field__label" id="timer-length">How long</span>
        <SegmentedControl
          label="How long"
          block
          value={minutes}
          onChange={setMinutes}
          options={TIMER_CHOICES.map((m) => ({ value: m, label: `${m} min` }))}
        />
      </div>
      <Field label="What it’s for" optional error={error}>
        <TextInput value={label} maxLength={300} placeholder="Tea" onChange={(e) => setLabel(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** The four things people do most from Home. */
export function QuickActions({ compact }: { readonly compact: boolean }) {
  const [timerOpen, setTimerOpen] = useState(false);
  const [starting, setStarting] = useState<VoiceMode | null>(null);

  const startVoice = async (mode: VoiceMode) => {
    setStarting(mode);
    try {
      await invoke('voice:start', { mode, source: 'dashboard' });
    } catch (err) {
      toast.error(`Rivertide couldn’t start listening. ${errorMessage(err)}`);
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="home__actions">
      <Button variant="accent" icon={Mic} loading={starting === 'dictate'} onClick={() => void startVoice('dictate')}>
        Start dictation
      </Button>
      <Button icon={Sprout} loading={starting === 'command'} onClick={() => void startVoice('command')}>
        Talk to Leafy
      </Button>
      {compact ? null : (
        <>
          <Button icon={NotebookPen} onClick={() => navigate('/notes/new')}>New note</Button>
          <Button icon={Timer} onClick={() => setTimerOpen(true)}>Set a timer</Button>
        </>
      )}
      <TimerDialog open={timerOpen} onClose={() => setTimerOpen(false)} />
    </div>
  );
}
