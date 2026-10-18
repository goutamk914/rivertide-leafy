import { useState } from 'react';
import { CircleAlert, Trash2 } from 'lucide-react';
import { errorMessage, invoke } from '../../../../lib/ipc';
import { Button, Dialog, Field, ICON_STROKE, TextInput, toast } from '../../../../ui/components';

export const CONFIRM_WORD = 'DELETE';

const DELETED_ITEMS: readonly string[] = [
  'Your history of dictations, questions and commands',
  'Notes, reminders and timers',
  'Memory, your dictionary and chats',
  'Imported documents and saved recordings',
  'Your settings and API keys',
];

export interface WipeDataDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** "Delete all data": the destructive button only works once the person has typed DELETE exactly. */
export function WipeDataDialog({ open, onClose }: WipeDataDialogProps) {
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed === CONFIRM_WORD;

  const close = () => {
    if (pending) return;
    setTyped('');
    setError(null);
    onClose();
  };

  const wipe = async () => {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      await invoke('data:wipe', { confirm: CONFIRM_WORD });
      setTyped('');
      onClose();
      toast.info('All Rivertide data was deleted. Rivertide will restart and open setup.');
    } catch (err) {
      setError(`Rivertide couldn’t finish deleting your data. ${errorMessage(err)} Try again, or restart Rivertide and try again.`);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      role="alertdialog"
      title="Delete all Rivertide data?"
      description="This permanently deletes everything Rivertide keeps on this computer. It can’t be undone."
      dismissible={!pending}
      actions={
        <>
          <Button onClick={close} disabled={pending}>Cancel</Button>
          <Button variant="danger-solid" icon={Trash2} disabled={!ready} loading={pending} onClick={() => void wipe()}>
            Delete everything
          </Button>
        </>
      }
    >
      <div className="settings-wipe">
        <p>This deletes:</p>
        <ul className="settings-wipe__list">
          {DELETED_ITEMS.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="settings-note">Rivertide restarts afterwards and opens setup again. Want a copy first? Cancel, then choose Export my data.</p>
        <Field label={`Type ${CONFIRM_WORD} to confirm`} help="Use capital letters.">
          <TextInput
            value={typed}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && ready) void wipe();
            }}
          />
        </Field>
        {error ? (
          <p className="settings-wipe__error" role="alert">
            <CircleAlert size={18} strokeWidth={ICON_STROKE} aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
