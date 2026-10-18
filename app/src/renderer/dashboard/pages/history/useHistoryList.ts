import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryItem, VoiceMode } from '@shared/types';
import { errorMessage, invoke } from '../../../lib/ipc';
import { useIpcEvent } from '../../hooks/useIpc';

export const HISTORY_PAGE_SIZE = 50;
const MAX_LIMIT = 500;

export interface HistoryListState {
  readonly items: readonly HistoryItem[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly error: string | null;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

/** Paged history ("before" cursor), reset by query/mode, refreshed in place when history changes. */
export function useHistoryList(query: string, mode: VoiceMode | null): HistoryListState {
  const [items, setItems] = useState<readonly HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const countRef = useRef(0);

  const fetchPage = useCallback(
    (limit: number, before?: string) =>
      invoke('history:list', { limit, ...(query.trim() ? { query: query.trim() } : {}), ...(mode ? { mode } : {}), ...(before ? { before } : {}) }),
    [query, mode],
  );

  const refresh = useCallback(
    (limit: number) => {
      const mine = ++generation.current;
      fetchPage(limit)
        .then((page) => {
          if (mine !== generation.current) return;
          setItems(page);
          countRef.current = page.length;
          setHasMore(page.length >= limit);
          setError(null);
        })
        .catch((err: unknown) => {
          if (mine === generation.current) setError(errorMessage(err));
        })
        .finally(() => {
          if (mine === generation.current) setLoading(false);
        });
    },
    [fetchPage],
  );

  useEffect(() => {
    setLoading(true);
    refresh(HISTORY_PAGE_SIZE);
  }, [refresh]);

  useIpcEvent('data:changed', ({ domain }) => {
    if (domain === 'history') refresh(Math.min(MAX_LIMIT, Math.max(HISTORY_PAGE_SIZE, countRef.current)));
  });

  const loadMore = useCallback(() => {
    const last = items[items.length - 1];
    if (!last || loadingMore || !hasMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setError(null);
    fetchPage(HISTORY_PAGE_SIZE, last.createdAt)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems((current) => {
          const seen = new Set(current.map((i) => i.id));
          const next = [...current, ...page.filter((i) => !seen.has(i.id))];
          countRef.current = next.length;
          return next;
        });
        setHasMore(page.length >= HISTORY_PAGE_SIZE);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoadingMore(false));
  }, [items, loadingMore, hasMore, fetchPage]);

  const reload = useCallback(() => {
    setLoading(true);
    refresh(HISTORY_PAGE_SIZE);
  }, [refresh]);

  return { items, loading, loadingMore, hasMore, error, loadMore, reload };
}
