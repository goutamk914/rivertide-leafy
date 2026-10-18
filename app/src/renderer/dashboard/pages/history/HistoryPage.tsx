import { useCallback, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { HistoryItem, VoiceMode } from '@shared/types';
import { groupByDay } from '../../../lib/format';
import { invoke } from '../../../lib/ipc';
import { navigate } from '../../../lib/router';
import { Button, EmptyState, IconButton, SegmentedControl, SkeletonList, TextInput } from '../../../ui/components';
import { useCalm } from '../../app-context';
import { MODE_LABELS } from '../../components/ModeBadge';
import { useDebounced, useNow } from '../../hooks/useIpc';
import { useItemLookup, useMissingItem } from '../../hooks/useMissingItem';
import { useUndoableDelete } from '../../hooks/useUndoableDelete';
import { byDataId, focusSoon, neighbourOf } from '../../lib/focus';
import { Page, PageError, type PageComponentProps } from '../../shell/Page';
import { HistoryDetail } from './HistoryDetail';
import { HISTORY_ID_ATTR, HISTORY_LIST_ID, HistoryList } from './HistoryList';
import { useHistoryList } from './useHistoryList';
import './history.css';

type ModeFilter = 'all' | VoiceMode;

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'dictate', label: MODE_LABELS.dictate },
  { value: 'ask', label: MODE_LABELS.ask },
  { value: 'command', label: MODE_LABELS.command },
] as const satisfies readonly { value: ModeFilter; label: string }[];

export const MISSING_HISTORY = 'That item isn’t in your history any more. It may have been deleted.';
const lookupHistory = (id: string) => invoke('history:get', { id });

function Toolbar({ query, setQuery, mode, setMode }: { query: string; setQuery: (q: string) => void; mode: ModeFilter; setMode: (m: ModeFilter) => void }) {
  return (
    <div className="history-toolbar">
      <div className="history-toolbar__search">
        <TextInput
          type="search"
          aria-label="Search history"
          placeholder="Search what you said"
          leadingIcon={Search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          trailing={query ? <IconButton label="Clear search" icon={X} size="sm" variant="plain" tooltip={false} onClick={() => setQuery('')} /> : undefined}
        />
      </div>
      <SegmentedControl label="Show" options={FILTERS} value={mode} onChange={setMode} />
    </div>
  );
}

export function HistoryPage({ route }: PageComponentProps) {
  const calm = useCalm();
  const now = useNow();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ModeFilter>('all');
  const debounced = useDebounced(query);
  const list = useHistoryList(calm ? '' : debounced, mode === 'all' || calm ? null : mode);
  const removal = useUndoableDelete(useCallback((id: string) => invoke('history:delete', { id }), []));
  const visible = useMemo(() => list.items.filter((i) => !removal.hidden.has(i.id)), [list.items, removal.hidden]);
  const groups = useMemo(() => groupByDay(visible, (i) => i.createdAt, now), [visible, now]);

  const routeId = route.section && !removal.hidden.has(route.section) ? route.section : null;
  const inList = routeId ? visible.find((i) => i.id === routeId) : undefined;
  const lookup = useItemLookup(routeId, !list.loading && !inList, lookupHistory);
  useMissingItem(lookup.status === 'missing', '/history', MISSING_HISTORY);
  const selected: HistoryItem | null = routeId ? inList ?? lookup.item : visible[0] ?? null;

  const select = (id: string) => navigate(`/history/${id}`, { replace: true });
  const onDelete = (item: HistoryItem) => {
    const next = neighbourOf(visible, item.id);
    removal.remove(item.id, 'Deleted from history.');
    if (next) select(next.id);
    else navigate('/history', { replace: true });
    focusSoon(...(next ? [byDataId(HISTORY_ID_ATTR, next.id)] : []), `#${HISTORY_LIST_ID}`);
  };
  const filtering = Boolean(debounced.trim()) || mode !== 'all';
  const clearFilters = () => {
    setQuery('');
    setMode('all');
  };

  return (
    <Page title="History" description={calm ? undefined : 'Everything you said to Rivertide, and what it wrote. Only on this computer.'} layout="split">
      {calm ? null : <Toolbar query={query} setQuery={setQuery} mode={mode} setMode={setMode} />}
      {list.error && list.items.length === 0 ? <PageError message={list.error} onRetry={list.reload} /> : (
        <div className="split">
          <section className="split__list" aria-label="History list">
            <div id={HISTORY_LIST_ID} className="history-list" aria-busy={list.loading} tabIndex={-1}>
              {list.loading && list.items.length === 0 ? <SkeletonList rows={6} label="Loading history" /> : null}
              {!list.loading && visible.length === 0 ? (
                filtering ? (
                  <EmptyState compact pose="think-hmm" title="Nothing matches that." action={<Button onClick={clearFilters}>Clear filters</Button>} />
                ) : (
                  <EmptyState compact pose="wave-hi" title="Nothing here yet.">Hold fn and say something. It will show up here.</EmptyState>
                )
              ) : null}
              <HistoryList
                groups={groups}
                selectedId={selected?.id ?? null}
                onSelect={select}
                hasMore={list.hasMore}
                loadingMore={list.loadingMore}
                moreError={list.items.length > 0 ? list.error : null}
                onLoadMore={list.loadMore}
              />
            </div>
          </section>
          <section className="split__detail" aria-label="Selected item">
            {selected ? (
              <HistoryDetail key={selected.id} item={selected} calm={calm} onDelete={onDelete} />
            ) : list.loading || lookup.status === 'loading' ? null : lookup.status === 'error' ? (
              <div style={{ padding: 24 }}><PageError message={`This item didn’t load. ${lookup.error ?? ''}`} /></div>
            ) : (
              <EmptyState compact pose="reading" title="Pick something on the left to see it here." />
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
