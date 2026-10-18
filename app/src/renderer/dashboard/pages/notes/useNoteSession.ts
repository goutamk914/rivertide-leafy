import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '@shared/types';
import { navigate } from '../../../lib/router';

export const NEW_NOTE = 'new';

/** What the editor pane is showing: the first note, a specific note, or a new draft. */
export interface NoteSession {
  readonly mode: 'first' | 'note' | 'new';
  /** Changes only when the user (or a link) opens something else, so a draft keeps its editor. */
  readonly key: string;
  readonly noteId: string | null;
}

let draftCounter = 0;

export function sessionFor(section: string | null): NoteSession {
  if (section === NEW_NOTE) {
    draftCounter += 1;
    return { mode: 'new', key: `new-${draftCounter}`, noteId: null };
  }
  if (section) return { mode: 'note', key: `note-${section}`, noteId: section };
  return { mode: 'first', key: 'first', noteId: null };
}

/**
 * Follows `/notes/<section>`. When a new draft is first saved we replace the URL with the new note's
 * id; that one navigation is recognised and keeps the same editor (no remount, no lost cursor).
 * Any other navigation (a list click, the palette, New note) opens a fresh session.
 */
export function useNoteSession(section: string | null): { readonly session: NoteSession; readonly onCreated: (note: Note) => void } {
  const [session, setSession] = useState(() => sessionFor(section));
  const [seen, setSeen] = useState(section);
  const created = useRef<string | null>(null);

  // Adjusting state during render (not in an effect) so the editor never shows the old note for a frame.
  // The ref is only read here; it is cleared in the effect below, which keeps StrictMode double renders consistent.
  if (section !== seen) {
    setSeen(section);
    if (section === null || section !== created.current) setSession(sessionFor(section));
  }

  useEffect(() => {
    if (section !== null && section === created.current) created.current = null;
  }, [section]);

  const onCreated = useCallback((note: Note) => {
    created.current = note.id;
    navigate(`/notes/${note.id}`, { replace: true });
  }, []);

  return { session, onCreated };
}
