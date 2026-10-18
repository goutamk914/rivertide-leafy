import { useCallback, useState } from 'react';
import { errorMessage } from '../../lib/ipc';
import { toast } from '../../ui/components';

/** How long the Undo toast waits before the delete is committed. */
export const UNDO_WINDOW_MS = 5000;

export interface UndoableDelete {
  /** Ids hidden from the list while their Undo window is open (and after commit, until data reloads). */
  readonly hidden: ReadonlySet<string>;
  readonly remove: (id: string, message: string) => void;
}

/**
 * Optimistic delete with an Undo toast: the item disappears immediately and is deleted for real
 * once the toast closes without Undo (timeout or dismiss). Undo is a button in the toast and also
 * ⌘Z / Ctrl+Z (outside text fields). Failures bring the item back and say so.
 */
export function useUndoableDelete(commit: (id: string) => Promise<unknown>, onCommitted?: (id: string) => void): UndoableDelete {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  const show = useCallback((id: string) => {
    setHidden((current) => new Set([...current].filter((x) => x !== id)));
  }, []);

  const remove = useCallback(
    (id: string, message: string) => {
      setHidden((current) => new Set([...current, id]));
      toast.info(message, {
        durationMs: UNDO_WINDOW_MS,
        action: { label: 'Undo', onClick: () => show(id), shortcut: 'undo' },
        onClose: (reason) => {
          if (reason === 'action') return;
          commit(id)
            .then(() => onCommitted?.(id))
            .catch((error: unknown) => {
              show(id);
              toast.error(`Couldn’t delete it. ${errorMessage(error)} Try again in a moment.`);
            });
        },
      });
    },
    [commit, onCommitted, show],
  );

  return { hidden, remove };
}
