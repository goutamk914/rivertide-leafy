import { useId, useRef, useState, type FormEvent } from 'react';
import type { DictionaryEntry } from '@shared/types';
import { Badge, Button, Dialog, Field, TextInput, toast } from '../../../ui/components';
import { errorMessage, invoke } from '../../../lib/ipc';
import {
  REPLACES_LIMIT, draftFromEntry, parseReplaces, validateDictionaryDraft,
  type DictionaryDraft, type DictionaryField,
} from './dictionary-model';

export interface DictionaryDialogProps {
  /** The entry to edit, or null to add a new word. */
  readonly entry: DictionaryEntry | null;
  readonly onClose: () => void;
}

function saveEntry(entry: DictionaryEntry | null, draft: DictionaryDraft): Promise<DictionaryEntry> {
  return invoke('dictionary:upsert', {
    entry: {
      ...(entry ? { id: entry.id } : {}),
      term: draft.term.trim(),
      replaces: parseReplaces(draft.replaces),
      note: draft.note.trim(),
    },
  });
}

function ReplacesPreview({ raw }: { readonly raw: string }) {
  const parts = parseReplaces(raw);
  if (parts.length === 0) return null;
  return (
    <div className="knowledge-form__chips">
      <ul className="knowledge-chips" aria-label="Mishearings to replace">
        {parts.map((part) => (
          <li key={part.toLowerCase()}>
            <Badge>{part}</Badge>
          </li>
        ))}
      </ul>
      <span className="knowledge-form__count tabular">{parts.length} of {REPLACES_LIMIT}</span>
    </div>
  );
}

/** Add or edit a dictionary word. Mounted only while open, so every opening starts fresh. */
export function DictionaryDialog({ entry, onClose }: DictionaryDialogProps) {
  const formId = useId();
  const refs = { term: useRef<HTMLInputElement>(null), replaces: useRef<HTMLInputElement>(null), note: useRef<HTMLInputElement>(null) };
  const [draft, setDraft] = useState(() => draftFromEntry(entry));
  const [touched, setTouched] = useState<ReadonlySet<DictionaryField>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = validateDictionaryDraft(draft);
  const shownError = (field: DictionaryField) => (submitted || touched.has(field) ? errors[field] ?? null : null);
  const update = (patch: Partial<DictionaryDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const touch = (field: DictionaryField) => setTouched((current) => new Set([...current, field]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    const firstInvalid = (['term', 'replaces', 'note'] as const).find((field) => errors[field]);
    if (firstInvalid) return refs[firstInvalid].current?.focus();
    setSaving(true);
    setSaveError(null);
    try {
      await saveEntry(entry, draft);
      toast.success(entry ? 'Word updated.' : 'Word added.');
      onClose();
    } catch (error) {
      setSaveError(`Couldn’t save this word. ${errorMessage(error)} Try again.`);
      setSaving(false);
    }
  };

  const actions = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" type="submit" form={formId} loading={saving}>{entry ? 'Save changes' : 'Add word'}</Button>
    </>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? 'Edit word' : 'Add a word'}
      description="Rivertide swaps what it hears for the spelling you choose."
      initialFocus={refs.term}
      dismissible={!saving}
      actions={actions}
    >
      <form id={formId} className="knowledge-form" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Word" help="Spelled the way you want it, like “Oxaliplatin”." error={shownError('term')} required>
          <TextInput ref={refs.term} value={draft.term} autoComplete="off" onChange={(e) => update({ term: e.target.value })} onBlur={() => touch('term')} />
        </Field>
        <Field label="Replaces" help="What Rivertide hears instead, separated by commas." error={shownError('replaces')} optional>
          <TextInput ref={refs.replaces} value={draft.replaces} autoComplete="off" placeholder="ox ally platin, oxally platin" onChange={(e) => update({ replaces: e.target.value })} onBlur={() => touch('replaces')} />
        </Field>
        <ReplacesPreview raw={draft.replaces} />
        <Field label="Note" help="Something to jog your memory, like “Chemo medicine”." error={shownError('note')} optional>
          <TextInput ref={refs.note} value={draft.note} autoComplete="off" onChange={(e) => update({ note: e.target.value })} onBlur={() => touch('note')} />
        </Field>
        {saveError ? <p className="knowledge-form__error" role="alert">{saveError}</p> : null}
      </form>
    </Dialog>
  );
}
