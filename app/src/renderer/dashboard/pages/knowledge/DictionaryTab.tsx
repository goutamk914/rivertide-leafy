import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { DictionaryEntry } from '@shared/types';
import { Badge, Button, Card, EmptyState, IconButton, SkeletonList } from '../../../ui/components';
import { invoke } from '../../../lib/ipc';
import { formatCount, pluralize } from '../../../lib/format';
import { useIpcQuery } from '../../hooks/useIpc';
import { useUndoableDelete } from '../../hooks/useUndoableDelete';
import { PageError } from '../../shell/Page';
import { DICTIONARY_SOURCE_NAMES } from './dictionary-model';
import { DictionaryDialog } from './DictionaryDialog';

const loadEntries = () => invoke('dictionary:list', undefined);
const deleteEntry = (id: string) => invoke('dictionary:delete', { id });

interface RowProps {
  readonly entry: DictionaryEntry;
  readonly onEdit: (entry: DictionaryEntry) => void;
  readonly onDelete: (entry: DictionaryEntry) => void;
}

function DictionaryRow({ entry, onEdit, onDelete }: RowProps) {
  return (
    <tr>
      <th scope="row">
        <span className="knowledge-table__term">{entry.term}</span>
        {entry.note ? <span className="knowledge-table__note">{entry.note}</span> : null}
      </th>
      <td>
        {entry.replaces.length > 0 ? (
          <ul className="knowledge-chips">
            {entry.replaces.map((heard) => (
              <li key={heard}>
                <Badge>{heard}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">Nothing yet</span>
        )}
      </td>
      <td className="knowledge-table__num tabular">{formatCount(entry.uses)}</td>
      <td>{DICTIONARY_SOURCE_NAMES[entry.source]}</td>
      <td>
        <div className="knowledge-table__actions">
          <IconButton label={`Edit ${entry.term}`} icon={Pencil} onClick={() => onEdit(entry)} />
          <IconButton label={`Delete ${entry.term}`} icon={Trash2} variant="danger" onClick={() => onDelete(entry)} />
        </div>
      </td>
    </tr>
  );
}

function DictionaryTable({ entries, onEdit, onDelete }: Omit<RowProps, 'entry'> & { readonly entries: readonly DictionaryEntry[] }) {
  return (
    <Card padding="flush" className="knowledge-table-wrap">
      <table className="knowledge-table">
        <caption className="visually-hidden">Your dictionary, {pluralize(entries.length, 'word')}</caption>
        <thead>
          <tr>
            <th scope="col">Word</th>
            <th scope="col">Replaces</th>
            <th scope="col" className="knowledge-table__num">Uses</th>
            <th scope="col">Source</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <DictionaryRow key={entry.id} entry={entry} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** "Dictionary" tab: words Rivertide should spell your way, with what it tends to hear instead. */
export function DictionaryTab() {
  const entries = useIpcQuery(loadEntries, [], ['dictionary']);
  const { hidden, remove } = useUndoableDelete(deleteEntry);
  const [editing, setEditing] = useState<{ readonly entry: DictionaryEntry | null } | null>(null);
  const visible = useMemo(() => (entries.data ?? []).filter((entry) => !hidden.has(entry.id)), [entries.data, hidden]);

  const add = () => setEditing({ entry: null });
  const onDelete = (entry: DictionaryEntry) => remove(entry.id, `Deleted “${entry.term}”.`);

  const body = (() => {
    if (entries.loading) return <SkeletonList rows={4} label="Loading your dictionary" />;
    if (entries.error && !entries.data) return <PageError message={`Couldn’t load your dictionary. ${entries.error}`} onRetry={entries.reload} />;
    if (visible.length === 0) {
      return (
        <EmptyState pose="writing-notes" title="No words yet." action={<Button variant="primary" icon={Plus} onClick={add}>Add a word</Button>}>
          Add a word and what Rivertide hears instead, and it will use your spelling.
        </EmptyState>
      );
    }
    return <DictionaryTable entries={visible} onEdit={(entry) => setEditing({ entry })} onDelete={onDelete} />;
  })();

  return (
    <div className="knowledge-dictionary">
      <div className="knowledge-toolbar">
        <p className="knowledge-toolbar__intro">Add names and medicines Rivertide mishears.</p>
        <Button variant="primary" icon={Plus} onClick={add}>Add a word</Button>
      </div>
      {body}
      {editing ? <DictionaryDialog entry={editing.entry} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
