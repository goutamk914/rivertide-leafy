import { useId, useState, type FormEvent } from 'react';
import { Check, ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import type { SecretStatus } from '@shared/ipc';
import type { SecretId } from '@shared/settings';
import { errorMessage, invoke } from '../../../../lib/ipc';
import { Badge, Button, Card, Dialog, Field, TextInput, toast } from '../../../../ui/components';
import { openExternal } from './external';
import { ProviderTest } from './ProviderTest';

const KEY_MAX = 500;

export interface ProviderKeyCardProps {
  readonly secretId: SecretId;
  readonly name: string;
  readonly note: string;
  readonly keyUrl: string | null;
  /** undefined while `secrets:status` loads. */
  readonly isSet: boolean | undefined;
  readonly test: { readonly kind: 'llm' | 'stt'; readonly providerId: string };
  readonly onStatus: (status: SecretStatus) => void;
}

function validateKey(value: string): string | null {
  if (!value) return 'Paste a key first.';
  return value.length > KEY_MAX ? 'That’s longer than any key Rivertide accepts. Check that you copied only the key.' : null;
}

function KeyBadge({ isSet }: { readonly isSet: boolean | undefined }) {
  if (isSet === undefined) return <Badge>Checking…</Badge>;
  return isSet ? <Badge tone="accent" icon={Check}>Saved</Badge> : <Badge>Not set</Badge>;
}

/**
 * One provider's API key: status badge, a password field that empties after saving (keys are never
 * shown again), remove with confirmation, a connection test and a link to get a key.
 */
export function ProviderKeyCard({ secretId, name, note, keyUrl, isSet, test, onStatus }: ProviderKeyCardProps) {
  const titleId = useId();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    const problem = validateKey(value);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const status = await invoke('secrets:set', { id: secretId, value });
      setDraft('');
      onStatus(status);
      toast.success(`${name} key saved.`);
    } catch (err) {
      setError(`The key wasn’t saved. ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      onStatus(await invoke('secrets:clear', { id: secretId }));
      setConfirmRemove(false);
      toast.info(`${name} key removed.`);
    } catch (err) {
      toast.error(`The key wasn’t removed. ${errorMessage(err)}`);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Card as="section" tone="sunken" className="settings-key-card" aria-labelledby={titleId}>
      <div className="settings-key-card__head">
        <h4 id={titleId} className="settings-key-card__title">{name}</h4>
        <KeyBadge isSet={isSet} />
      </div>
      <p className="settings-note">{note}</p>
      <form className="settings-key-card__form" onSubmit={(event) => void save(event)} noValidate>
        <Field label={`${name} API key`} error={error}>
          <TextInput
            type="password"
            leadingIcon={KeyRound}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            placeholder={isSet ? 'Paste a new key to replace it' : 'Paste your key'}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <div className="settings-key-card__actions">
          <Button type="submit" variant="primary" size="sm" loading={saving}>Save key</Button>
          {isSet ? (
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmRemove(true)}>Remove key</Button>
          ) : null}
          {keyUrl ? (
            <Button size="sm" variant="quiet" iconEnd={ExternalLink} onClick={() => void openExternal(keyUrl)}>Get a key</Button>
          ) : null}
        </div>
      </form>
      <ProviderTest kind={test.kind} providerId={test.providerId} name={name} />
      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        role="alertdialog"
        title={`Remove the ${name} key?`}
        description={`Rivertide stops using ${name} until you add a key again.`}
        dismissible={!removing}
        actions={
          <>
            <Button onClick={() => setConfirmRemove(false)} disabled={removing}>Keep key</Button>
            <Button variant="danger-solid" icon={Trash2} loading={removing} onClick={() => void remove()}>Remove key</Button>
          </>
        }
      />
    </Card>
  );
}
