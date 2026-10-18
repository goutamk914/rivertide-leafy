import { useCallback, useMemo, useState } from 'react';
import { Pin, Plus, Search } from 'lucide-react';
import type { Note } from '@shared/types';
import { firstLine, formatRelative } from '../../../lib/format';
import { invoke } from '../../../lib/ipc';
import { navigate } from '../../../lib/router';
import { Button, EmptyState, ICON_STROKE, IconButton, Skeleton, SkeletonList, TextInput } from '../../../ui/components';
import { useDebounced, useIpcQuery, useNow } from '../../hooks/useIpc';
import { useItemLookup, useMissingItem } from '../../hooks/useMissingItem';
import { useUndoableDelete } from '../../hooks/useUndoableDelete';
import { byDataId, focusSoon, neighbourOf } from '../../lib/focus';
import { PageError } from '../../shell/Page';
import { NoteEditor } from './NoteEditor';
import { NEW_NOTE, useNoteSession } from './useNoteSession';

export { NEW_NOTE } from './useNoteSession';

const NOTE_ID_ATTR = 'data-note-id';
const NEW_NOTE_BUTTON_ID = 'notes-new';
export const MISSING_NOTE = 'That note isn’t here any more. It may have been deleted.';

/** Finds one note even when the search box filters it out of the list. */
const lookupNote = (id: string) => invoke('notes:list', {}).then((notes) => notes.find((n) => n.id === id) ?? null);

function NoteRow({ note, current, now }: { readonly note: Note; readonly current: boolean; readonly now: Date }) {
  return (
    <button
      type="button"
      className="note-row"
      aria-current={current || undefined}
      onClick={() => navigate(`/notes/${note.id}`, { replace: true })}
      {...{ [NOTE_ID_ATTR]: note.id }}
    >
      <span className="note-row__title">
        {note.pinned ? <Pin size={14} strokeWidth={ICON_STROKE} aria-label="Pinned" /> : null}
        {note.title || 'Untitled note'}
      </span>
      <span className="note-row__preview">{formatRelative(note.updatedAt, now)}{note.body ? ` · ${firstLine(note.body, 60)}` : ''}</span>
    </button>
  );
}

export function NotesPanel({ section }: { readonly section: string | null }) {
  const now = useNow();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);
  const list = useIpcQuery(() => invoke('notes:list', debounced.trim() ? { query: debounced.trim() } : {}), [debounced], ['notes']);
  const removal = useUndoableDelete(useCallback((id: string) => invoke('notes:delete', { id }), []));
  const notes = useMemo(() => (list.data ?? []).filter((n) => !removal.hidden.has(n.id)), [list.data, removal.hidden]);
  const { session, onCreated } = useNoteSession(section);

  const wantedId = session.mode === 'note' && session.noteId && !removal.hidden.has(session.noteId) ? session.noteId : null;
  const inList = wantedId ? notes.find((n) => n.id === wantedId) : undefined;
  const lookup = useItemLookup(wantedId, list.data !== undefined && !inList, lookupNote);
  useMissingItem(lookup.status === 'missing', '/notes', MISSING_NOTE);

  const current: Note | null = session.mode === 'note' ? inList ?? lookup.item ?? null : session.mode === 'first' ? notes[0] ?? null : null;
  const waitingForNote = session.mode === 'note' && !current && lookup.status !== 'missing' && lookup.status !== 'error';
  const editorKey = session.mode === 'first' ? (current ? `first-${current.id}` : null) : session.key;
  const highlightId = session.mode === 'new' ? (section !== NEW_NOTE ? section : null) : current?.id ?? null;

  const onDelete = (id: string) => {
    const next = neighbourOf(notes, id);
    removal.remove(id, 'Note deleted.');
    navigate(next ? `/notes/${next.id}` : '/notes', { replace: true });
    focusSoon(...(next ? [byDataId(NOTE_ID_ATTR, next.id)] : []), `#${NEW_NOTE_BUTTON_ID}`);
  };

  return (
    <div className="split">
      <section className="split__list" aria-label="Notes">
        <div className="notes-list-head">
          <div style={{ flex: 1 }}>
            <TextInput type="search" aria-label="Search notes" placeholder="Search notes" leadingIcon={Search} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <IconButton id={NEW_NOTE_BUTTON_ID} label="New note" icon={Plus} onClick={() => navigate(`/notes/${NEW_NOTE}`)} />
        </div>
        {list.error ? <div style={{ padding: 12 }}><PageError message={list.error} onRetry={list.reload} /></div> : null}
        {list.loading ? <div style={{ padding: 8 }}><SkeletonList rows={4} label="Loading notes" /></div> : (
          <ul className="notes-list">
            {notes.length === 0 ? <li className="muted" style={{ padding: 12 }}>{debounced ? 'No notes match that.' : 'No notes yet.'}</li> : null}
            {notes.map((n) => (
              <li key={n.id}>
                <NoteRow note={n} current={n.id === highlightId} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="split__detail" aria-label="Editor">
        {editorKey && (session.mode !== 'note' || current) ? (
          <NoteEditor key={editorKey} note={current} onCreated={onCreated} onDelete={onDelete} />
        ) : waitingForNote || list.loading ? (
          <div style={{ padding: 24 }}><Skeleton height={32} width="60%" /><Skeleton height={160} style={{ marginTop: 16 }} /></div>
        ) : lookup.status === 'error' ? (
          <div style={{ padding: 24 }}><PageError message={`This note didn’t load. ${lookup.error ?? ''}`} /></div>
        ) : (
          <EmptyState pose="writing-notes" title="Nothing written yet." action={<Button variant="accent" icon={Plus} onClick={() => navigate(`/notes/${NEW_NOTE}`)}>New note</Button>}>
            Jot something down, or ask Leafy to “make a note”.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
