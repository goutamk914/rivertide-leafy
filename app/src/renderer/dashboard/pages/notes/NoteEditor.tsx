import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Pin, Trash2 } from 'lucide-react';
import type { Note } from '@shared/types';
import { errorMessage, invoke } from '../../../lib/ipc';
import { Button, ICON_STROKE, IconButton, Spinner } from '../../../ui/components';

export const AUTOSAVE_DELAY_MS = 800;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Draft {
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
}

/** Debounced autosave that never creates an empty note and never runs two saves at once. */
function useAutosave(initial: Note | null, onCreated: (note: Note) => void) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(initial?.id ?? null);
  const savedKey = useRef(JSON.stringify({ title: initial?.title ?? '', body: initial?.body ?? '', pinned: initial?.pinned ?? false }));
  const latest = useRef<Draft>({ title: initial?.title ?? '', body: initial?.body ?? '', pinned: initial?.pinned ?? false });
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** False after unmount: a final flush still saves, but must not navigate anywhere. */
  const mounted = useRef(true);

  const saveNow = useCallback(async () => {
    const draft = latest.current;
    const key = JSON.stringify(draft);
    if (key === savedKey.current) return;
    if (!idRef.current && !draft.title.trim() && !draft.body.trim()) return;
    setStatus('saving');
    try {
      const saved = await invoke('notes:upsert', { note: { ...(idRef.current ? { id: idRef.current } : {}), ...draft } });
      const created = idRef.current === null;
      idRef.current = saved.id;
      savedKey.current = key;
      setStatus('saved');
      setError(null);
      if (created && mounted.current) onCreated(saved);
    } catch (err) {
      setStatus('error');
      setError(`Not saved yet. ${errorMessage(err)}`);
    }
  }, [onCreated]);

  const requestSave = useCallback(() => {
    queue.current = queue.current.then(saveNow);
  }, [saveNow]);

  const update = useCallback((draft: Draft) => {
    latest.current = draft;
  }, []);

  // Flush unsaved edits when the editor goes away (switching notes, leaving the page).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSave();
    };
  }, [requestSave]);

  return { status, error, update, requestSave, id: () => idRef.current };
}

function SaveStatusText({ status, error, onRetry }: { readonly status: SaveStatus; readonly error: string | null; readonly onRetry: () => void }) {
  if (status === 'saving') return <span className="rt-status"><Spinner /> Saving</span>;
  if (status === 'saved') return <span className="rt-status rt-status--success"><CircleCheck size={16} strokeWidth={ICON_STROKE} aria-hidden /> Saved</span>;
  if (status === 'error') {
    return (
      <span className="rt-status rt-status--error">
        <CircleAlert size={16} strokeWidth={ICON_STROKE} aria-hidden /> {error}
        <Button size="sm" variant="quiet" onClick={onRetry}>Try again</Button>
      </span>
    );
  }
  return <span className="rt-status">Changes save as you type</span>;
}

export interface NoteEditorProps {
  readonly note: Note | null;
  readonly onCreated: (note: Note) => void;
  readonly onDelete: (id: string) => void;
}

export function NoteEditor({ note, onCreated, onDelete }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const autosave = useAutosave(note, onCreated);
  const { update, requestSave } = autosave;

  useEffect(() => {
    update({ title, body, pinned });
    const timer = setTimeout(requestSave, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, body, pinned, update, requestSave]);

  const id = autosave.id();
  return (
    <div className="note-editor">
      <div className="note-editor__bar">
        <div aria-live="polite"><SaveStatusText status={autosave.status} error={autosave.error} onRetry={requestSave} /></div>
        <div className="note-editor__tools">
          <IconButton label="Pin note" icon={Pin} aria-pressed={pinned} onClick={() => setPinned((p) => !p)} />
          {id ? <IconButton label="Delete note" icon={Trash2} variant="danger" onClick={() => onDelete(id)} /> : null}
        </div>
      </div>
      <label htmlFor="note-title" className="visually-hidden">Title</label>
      <input
        id="note-title"
        className="note-editor__title note-editor__field"
        placeholder="Untitled note"
        value={title}
        maxLength={200}
        autoFocus={note === null}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor="note-body" className="visually-hidden">Note</label>
      <textarea
        id="note-body"
        className="note-editor__body note-editor__field"
        placeholder="Write or hold fn to dictate"
        value={body}
        maxLength={100_000}
        onChange={(e) => setBody(e.target.value)}
      />
    </div>
  );
}
