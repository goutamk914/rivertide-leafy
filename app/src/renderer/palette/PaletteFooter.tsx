import { ArrowUpRight } from 'lucide-react';
import type { SearchResult } from '@shared/types';
import type { PaletteView } from './navigation';
import { rowHint } from './sections';

export interface PaletteFooterProps {
  readonly view: PaletteView;
  readonly active: SearchResult | null;
  readonly hasQuery: boolean;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onOpenChat: () => void;
}

function Hint({ keys, label }: { readonly keys: string; readonly label: string }) {
  return (
    <span className="pl-hint">
      <kbd className="pl-kbd">{keys}</kbd>
      {label}
    </span>
  );
}

/** A quiet row of what the keys do right now, plus any message from the last action. */
export function PaletteFooter({ view, active, hasQuery, busy, notice, onOpenChat }: PaletteFooterProps) {
  const hint = active ? rowHint(active) : null;
  return (
    <footer className="pl-footer">
      <p className="pl-footer__notice" role="status" aria-live="polite">
        {notice ?? ''}
      </p>
      <div className="pl-footer__hints">
        {view === 'search' ? (
          <>
            <Hint keys="↑↓" label="Move" />
            {hint ? <Hint keys="↵" label={hint.primary} /> : null}
            {hint?.alt ? <Hint keys="⌥↵" label={hint.alt} /> : null}
            {hasQuery ? <Hint keys="Tab" label="Ask Leafy" /> : null}
            <Hint keys="Esc" label={hasQuery ? 'Clear' : 'Close'} />
          </>
        ) : (
          <>
            <Hint keys="Esc" label={busy ? 'Stop' : 'Back'} />
            <button type="button" className="pl-link" onClick={onOpenChat}>
              Open in Chat
              <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
