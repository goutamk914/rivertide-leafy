/**
 * Pure helpers for the Dictionary tab: parsing the "replaces" list and the add/edit form rules.
 * Limits mirror the `dictionary:upsert` schema in the IPC contract.
 */
import type { DictionaryEntry } from '@shared/types';

export const TERM_MAX = 80;
export const REPLACE_MAX = 80;
export const REPLACES_LIMIT = 20;
export const NOTE_MAX = 200;

export const DICTIONARY_SOURCE_NAMES: Readonly<Record<DictionaryEntry['source'], string>> = {
  manual: 'Added by you',
  learned: 'Learned',
};

export interface DictionaryDraft {
  readonly term: string;
  /** Comma-separated mishearings, as typed. */
  readonly replaces: string;
  readonly note: string;
}

export type DictionaryField = 'term' | 'replaces' | 'note';
export type DictionaryErrors = Partial<Record<DictionaryField, string>>;

/** Splits on commas or new lines, trims, drops blanks and case-insensitive duplicates. */
export function parseReplaces(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function draftFromEntry(entry: DictionaryEntry | null): DictionaryDraft {
  if (!entry) return { term: '', replaces: '', note: '' };
  return { term: entry.term, replaces: entry.replaces.join(', '), note: entry.note };
}

function termError(term: string): string | undefined {
  const length = term.trim().length;
  if (length === 0) return 'Add the word as it should be spelled.';
  if (length > TERM_MAX) return `Keep the word to ${TERM_MAX} characters or fewer.`;
  return undefined;
}

function replacesError(raw: string): string | undefined {
  const parts = parseReplaces(raw);
  if (parts.length > REPLACES_LIMIT) return `Add up to ${REPLACES_LIMIT} mishearings. Remove ${parts.length - REPLACES_LIMIT} to save.`;
  const long = parts.find((part) => part.length > REPLACE_MAX);
  if (long) return `“${long.slice(0, 24)}…” is too long. Keep each one to ${REPLACE_MAX} characters.`;
  return undefined;
}

/** Inline error messages for the dictionary form; an empty object means it can be saved. */
export function validateDictionaryDraft(draft: DictionaryDraft): DictionaryErrors {
  const term = termError(draft.term);
  const replaces = replacesError(draft.replaces);
  const note = draft.note.length > NOTE_MAX ? `Keep the note to ${NOTE_MAX} characters or fewer.` : undefined;
  return { ...(term ? { term } : {}), ...(replaces ? { replaces } : {}), ...(note ? { note } : {}) };
}
