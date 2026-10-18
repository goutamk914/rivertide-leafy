import { useEffect, useRef } from 'react';
import type { HistoryItem, HistoryStatus } from '@shared/types';
import { firstLine, formatClock, type DayGroup } from '../../../lib/format';
import { Badge, Button, cx } from '../../../ui/components';
import { ModeBadge } from '../../components/ModeBadge';
import { byDataId } from '../../lib/focus';

export const HISTORY_LIST_ID = 'history-list';
export const HISTORY_ID_ATTR = 'data-history-id';

const STATUS_LABEL: Readonly<Record<Exclude<HistoryStatus, 'ok'>, string>> = {
  empty: 'Nothing heard',
  error: 'Didn’t finish',
  cancelled: 'Cancelled',
};

function HistoryRow({ item, selected, onSelect }: { readonly item: HistoryItem; readonly selected: boolean; readonly onSelect: () => void }) {
  const text = firstLine(item.mode === 'dictate' ? item.output || item.raw : item.raw, 140) || 'Nothing was heard';
  return (
    <button
      type="button"
      className={cx('history-row', item.status !== 'ok' && 'history-row--error')}
      aria-current={selected || undefined}
      onClick={onSelect}
      {...{ [HISTORY_ID_ATTR]: item.id }}
    >
      <span className="history-row__meta">
        <span className="history-row__time">{formatClock(item.createdAt)}</span>
        {item.app ? <span>· {item.app.name}</span> : null}
        {item.status !== 'ok' ? <Badge tone="warn">{STATUS_LABEL[item.status]}</Badge> : null}
        <ModeBadge mode={item.mode} />
      </span>
      <span className="history-row__text">{text}</span>
    </button>
  );
}

/** Loads more when the sentinel scrolls into view; the button is the keyboard path. Errors show inline. */
function LoadMore({ onLoad, loading, error }: { readonly onLoad: () => void; readonly loading: boolean; readonly error: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || error || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoad();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoad, error]);
  return (
    <div ref={ref} className="history-more">
      {error ? <p className="rt-status rt-status--error" role="alert">Older items didn’t load. {error}</p> : null}
      <Button size="sm" loading={loading} onClick={onLoad}>{error ? 'Try again' : 'Show older'}</Button>
    </div>
  );
}

export interface HistoryListProps {
  readonly groups: readonly DayGroup<HistoryItem>[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly moreError: string | null;
  readonly onLoadMore: () => void;
}

export function HistoryList({ groups, selectedId, onSelect, hasMore, loadingMore, moreError, onLoadMore }: HistoryListProps) {
  // Keep a row opened from a link (palette, Home) in view.
  useEffect(() => {
    if (!selectedId) return;
    document.querySelector(byDataId(HISTORY_ID_ATTR, selectedId))?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="history-group">
          <h2 className="history-group__label">{group.label}</h2>
          {group.items.map((item) => (
            <HistoryRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => onSelect(item.id)} />
          ))}
        </div>
      ))}
      {(hasMore || moreError) && groups.length > 0 ? <LoadMore onLoad={onLoadMore} loading={loadingMore} error={moreError} /> : null}
    </>
  );
}
