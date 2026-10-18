import { useState, type KeyboardEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ChatSummary } from '@shared/types';
import { formatRelative } from '../../../lib/format';
import { errorMessage, invoke } from '../../../lib/ipc';
import { Button, Dialog, IconButton, SkeletonList, TextInput, toast } from '../../../ui/components';
import { byDataId, focusSoon, neighbourOf } from '../../lib/focus';

const MAX_TITLE = 120;
const CHAT_ID_ATTR = 'data-chat-id';
const NEW_CHAT_ID = 'chat-new';

type DoneHow = 'keyboard' | 'blur';

function RenameField({ session, onDone }: { readonly session: ChatSummary; readonly onDone: (how: DoneHow) => void }) {
  const [title, setTitle] = useState(session.title);
  const [saving, setSaving] = useState(false);
  const save = async (how: DoneHow) => {
    const next = title.trim();
    if (!next || next === session.title) return onDone(how);
    setSaving(true);
    try {
      await invoke('chat:rename', { id: session.id, title: next.slice(0, MAX_TITLE) });
      onDone(how);
    } catch (error) {
      toast.error(`The new name wasn’t saved. ${errorMessage(error)}`);
      setSaving(false);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') void save('keyboard');
    if (event.key === 'Escape') {
      event.stopPropagation();
      onDone('keyboard');
    }
  };
  return (
    <div className="chat-session__rename">
      <TextInput
        aria-label="Chat name"
        autoFocus
        value={title}
        maxLength={MAX_TITLE}
        disabled={saving}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => void save('blur')}
      />
    </div>
  );
}

export interface ChatSessionsProps {
  readonly sessions: readonly ChatSummary[] | undefined;
  readonly currentId: string | null;
  readonly creating: boolean;
  readonly now: Date;
  readonly onCreate: () => void;
  readonly onDeleted: (id: string) => void;
}

export function ChatSessions({ sessions, currentId, creating, now, onCreate, onDeleted }: ChatSessionsProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ChatSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      await invoke('chat:delete', { id: confirming.id });
      const next = sessions ? neighbourOf(sessions, confirming.id) : null;
      onDeleted(confirming.id);
      setConfirming(null);
      focusSoon(...(next ? [byDataId(CHAT_ID_ATTR, next.id)] : []), `#${NEW_CHAT_ID}`);
    } catch (error) {
      toast.error(`The chat wasn’t deleted. ${errorMessage(error)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <nav className="chat-sessions" aria-label="Chats">
      <Button id={NEW_CHAT_ID} variant="primary" icon={Plus} loading={creating} onClick={onCreate} block>New chat</Button>
      {!sessions ? <div style={{ marginTop: 12 }}><SkeletonList rows={3} height={52} label="Loading chats" /></div> : (
        <ul className="chat-sessions__list">
          {sessions.length === 0 ? <li className="muted" style={{ padding: 12 }}>No chats yet.</li> : null}
          {sessions.map((s) => (
            <li key={s.id} className="chat-session" data-current={s.id === currentId}>
              {renaming === s.id ? (
                <RenameField
                  session={s}
                  onDone={(how) => {
                    setRenaming(null);
                    // Return focus to the chat only when the user finished with the keyboard, not after clicking away.
                    if (how === 'keyboard') focusSoon(byDataId(CHAT_ID_ATTR, s.id));
                  }}
                />
              ) : (
                <>
                  <a className="chat-session__link" href={`#/chat/${s.id}`} aria-current={s.id === currentId ? 'page' : undefined} {...{ [CHAT_ID_ATTR]: s.id }}>
                    <span className="chat-session__title">{s.title}</span>
                    <span className="chat-session__meta">{formatRelative(s.updatedAt, now)}{s.preview ? ` · ${s.preview}` : ''}</span>
                  </a>
                  <span className="chat-session__tools">
                    <IconButton label={`Rename ${s.title}`} icon={Pencil} size="sm" variant="plain" onClick={() => setRenaming(s.id)} />
                    <IconButton label={`Delete ${s.title}`} icon={Trash2} size="sm" variant="danger" onClick={() => setConfirming(s)} />
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        role="alertdialog"
        dismissible={!deleting}
        title="Delete this chat?"
        description={confirming ? `“${confirming.title}” and its messages will be removed from this computer. This can’t be undone.` : undefined}
        actions={
          <>
            <Button variant="quiet" onClick={() => setConfirming(null)} disabled={deleting}>Keep chat</Button>
            <Button variant="danger-solid" loading={deleting} onClick={() => void remove()}>Delete chat</Button>
          </>
        }
      />
    </nav>
  );
}
