import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { Fact } from '@shared/types';
import { Button, EmptyState, IconButton, SkeletonList, TextInput, toast } from '../../../ui/components';
import { errorMessage, invoke } from '../../../lib/ipc';
import { pluralize } from '../../../lib/format';
import { useDebounced, useIpcQuery, useNow, type QueryState } from '../../hooks/useIpc';
import { useUndoableDelete } from '../../hooks/useUndoableDelete';
import { PageError } from '../../shell/Page';
import { FactGroupSection, type FactActions } from './FactList';
import { groupFacts, type FactGroup } from './knowledge-model';

const SEARCH_DEBOUNCE_MS = 250;
/** Matches the `knowledge:list` query limit in the IPC contract. */
const SEARCH_MAX = 200;

const deleteFact = (id: string) => invoke('knowledge:delete', { id });

export interface FactsTabProps {
  readonly onEdit: (fact: Fact) => void;
  readonly onAdd: () => void;
}

type FactsQuery = QueryState<readonly Fact[]>;

/** Optimistic pin toggle: flips locally, saves, and flips back with an error toast if saving fails. */
function usePinToggle(mutate: FactsQuery['mutate'], announce: (message: string) => void) {
  return useCallback(
    async (fact: Fact) => {
      const pinned = !fact.pinned;
      const setPinned = (value: boolean) =>
        mutate((current) => current?.map((f) => (f.id === fact.id ? { ...f, pinned: value } : f)));
      setPinned(pinned);
      try {
        await invoke('knowledge:upsert', { fact: { id: fact.id, category: fact.category, label: fact.label, value: fact.value, pinned } });
        announce(`${pinned ? 'Pinned' : 'Unpinned'} “${fact.label}”.`);
      } catch (error) {
        setPinned(fact.pinned);
        toast.error(`Couldn’t ${pinned ? 'pin' : 'unpin'} “${fact.label}”. ${errorMessage(error)} Try again.`);
      }
    },
    [mutate, announce],
  );
}

interface SearchBoxProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onClear: () => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

function SearchBox({ value, onChange, onClear, inputRef }: SearchBoxProps) {
  return (
    <div className="knowledge-toolbar__search" role="search">
      <TextInput
        ref={inputRef}
        type="search"
        aria-label="Search facts"
        placeholder="Search facts"
        leadingIcon={Search}
        maxLength={SEARCH_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onClear();
          }
        }}
        trailing={value ? <IconButton label="Clear search" icon={X} size="sm" variant="plain" tooltip={false} onClick={onClear} /> : null}
      />
    </div>
  );
}

interface ResultsProps {
  readonly facts: FactsQuery;
  readonly groups: readonly FactGroup[];
  readonly query: string;
  readonly onAdd: () => void;
  readonly onClear: () => void;
  readonly rowActions: FactActions;
}

function Results({ facts, groups, query, onAdd, onClear, rowActions }: ResultsProps) {
  const now = useNow();
  if (facts.loading) return <SkeletonList rows={5} label="Loading facts" />;
  if (facts.error && !facts.data) return <PageError message={`Couldn’t load your facts. ${facts.error}`} onRetry={facts.reload} />;
  if (groups.length === 0 && !query) {
    return (
      <EmptyState pose="seed" title="Leafy hasn't learned anything yet." action={<Button variant="primary" icon={Plus} onClick={onAdd}>Add a fact</Button>}>
        Facts you add, or that Leafy picks up while you talk, show up here.
      </EmptyState>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="knowledge-nomatch">
        <p>No facts match “{query}”.</p>
        <Button size="sm" onClick={onClear}>Clear search</Button>
      </div>
    );
  }
  return (
    <div className="knowledge-groups">
      {facts.error ? <PageError message={`Couldn’t refresh your facts. ${facts.error}`} onRetry={facts.reload} /> : null}
      {groups.map((group) => (
        <FactGroupSection key={group.category} group={group} now={now} {...rowActions} />
      ))}
    </div>
  );
}

/** "Facts" tab: search, then every fact grouped by category with pin, edit and delete (with Undo). */
export function FactsTab({ onEdit, onAdd }: FactsTabProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const debounced = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const facts = useIpcQuery(() => invoke('knowledge:list', debounced ? { query: debounced } : {}), [debounced], ['knowledge']);
  const { hidden, remove } = useUndoableDelete(deleteFact);
  const onTogglePin = usePinToggle(facts.mutate, setStatus);

  const visible = useMemo(() => (facts.data ?? []).filter((fact) => !hidden.has(fact.id)), [facts.data, hidden]);
  const groups = useMemo(() => groupFacts(visible), [visible]);

  const clear = () => {
    setQuery('');
    searchRef.current?.focus();
  };
  const onDelete = (fact: Fact) => {
    remove(fact.id, `Deleted “${fact.label}”.`);
    searchRef.current?.focus();
  };
  const togglePin = (fact: Fact) => void onTogglePin(fact);
  const resultCount = debounced && facts.data ? `${pluralize(visible.length, 'fact')} match “${debounced}”.` : '';

  return (
    <div className="knowledge-facts">
      <div className="knowledge-toolbar">
        <SearchBox value={query} onChange={setQuery} onClear={clear} inputRef={searchRef} />
        <Button variant="primary" icon={Plus} onClick={onAdd}>Add a fact</Button>
      </div>
      <p className="visually-hidden" role="status">{resultCount}</p>
      <p className="visually-hidden" role="status">{status}</p>
      <Results facts={facts} groups={groups} query={debounced} onAdd={onAdd} onClear={clear} rowActions={{ onEdit, onDelete, onTogglePin: togglePin }} />
    </div>
  );
}
