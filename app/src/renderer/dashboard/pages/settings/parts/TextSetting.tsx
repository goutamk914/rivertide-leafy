import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Field, TextInput } from '../../../../ui/components';

/** A local editable copy of a saved value that resets whenever the saved value changes. */
export function useDraft<T>(value: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (!Object.is(source, value)) {
    setSource(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

export const trimmed = (value: string): string => value.trim();

export interface TextSettingProps {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly value: string;
  readonly onSave: (value: string) => void;
  /** Returns an error message, or null when the value is fine. Runs on blur and Enter. */
  readonly validate?: (value: string) => string | null;
  /** Cleans the value before validating and saving (defaults to trimming). */
  readonly normalize?: (value: string) => string;
  readonly placeholder?: string;
  /** Id of a <datalist> with suggestions. */
  readonly list?: string;
  readonly optional?: boolean;
  readonly autoComplete?: string;
  readonly spellCheck?: boolean;
}

/**
 * Text field that validates and saves when the person leaves it or presses Enter,
 * never on every keystroke. Errors show inline and nothing is saved until they're fixed.
 */
export function TextSetting({
  label, help, value, onSave, validate, normalize = trimmed, placeholder, list, optional, autoComplete = 'off', spellCheck = false,
}: TextSettingProps) {
  const [draft, setDraft] = useDraft(value);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const next = normalize(draft);
    const problem = validate?.(next) ?? null;
    setError(problem);
    if (problem !== null) return;
    if (next !== draft) setDraft(next);
    if (next !== value) onSave(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  };

  return (
    <Field label={label} help={help} error={error} optional={optional}>
      <TextInput
        value={draft}
        placeholder={placeholder}
        list={list}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </Field>
  );
}
