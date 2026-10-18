import { useId, useRef, useState, type FormEvent } from 'react';
import type { Fact } from '@shared/types';
import { Button, Dialog, Field, Select, TextArea, TextInput, Toggle, toast } from '../../../ui/components';
import { errorMessage, invoke } from '../../../lib/ipc';
import {
  CATEGORY_OPTIONS, draftFromFact, validateFactDraft, type FactDraft, type FactField,
} from './knowledge-model';

export interface FactDialogProps {
  /** The fact to edit, or null to add a new one. */
  readonly fact: Fact | null;
  readonly onClose: () => void;
}

function saveFact(fact: Fact | null, draft: FactDraft): Promise<Fact> {
  return invoke('knowledge:upsert', {
    fact: {
      ...(fact ? { id: fact.id } : {}),
      category: draft.category,
      label: draft.label.trim(),
      value: draft.value.trim(),
      pinned: draft.pinned,
    },
  });
}

/** Add or edit one fact. Mounted only while open, so every opening starts from a fresh draft. */
export function FactDialog({ fact, onClose }: FactDialogProps) {
  const formId = useId();
  const labelRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() => draftFromFact(fact));
  const [touched, setTouched] = useState<ReadonlySet<FactField>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = validateFactDraft(draft);
  const shownError = (field: FactField) => (submitted || touched.has(field) ? errors[field] ?? null : null);
  const update = (patch: Partial<FactDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const touch = (field: FactField) => setTouched((current) => new Set([...current, field]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    if (errors.label) return labelRef.current?.focus();
    if (errors.value) return valueRef.current?.focus();
    setSaving(true);
    setSaveError(null);
    try {
      await saveFact(fact, draft);
      toast.success(fact ? 'Fact updated.' : 'Fact saved.');
      onClose();
    } catch (error) {
      setSaveError(`Couldn’t save this fact. ${errorMessage(error)} Try again.`);
      setSaving(false);
    }
  };

  const actions = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" type="submit" form={formId} loading={saving}>{fact ? 'Save changes' : 'Save fact'}</Button>
    </>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={fact ? 'Edit fact' : 'Add a fact'}
      description="Leafy keeps this until you change or remove it."
      initialFocus={labelRef}
      dismissible={!saving}
      actions={actions}
    >
      <form id={formId} className="knowledge-form" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Category">
          <Select options={CATEGORY_OPTIONS} value={draft.category} onChange={(category) => update({ category })} />
        </Field>
        <Field label="Label" help="A few words, like “Oxaliplatin”." error={shownError('label')} required>
          <TextInput ref={labelRef} value={draft.label} autoComplete="off" onChange={(e) => update({ label: e.target.value })} onBlur={() => touch('label')} />
        </Field>
        <Field label="What to remember" help="One or two sentences in your own words." error={shownError('value')} required>
          <TextArea ref={valueRef} rows={3} value={draft.value} onChange={(e) => update({ value: e.target.value })} onBlur={() => touch('value')} />
        </Field>
        <Toggle label="Pin this fact" description="Pinned facts stay at the top of the list." checked={draft.pinned} onChange={(pinned) => update({ pinned })} />
        {saveError ? <p className="knowledge-form__error" role="alert">{saveError}</p> : null}
      </form>
    </Dialog>
  );
}
