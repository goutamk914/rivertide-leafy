import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cx } from './cx';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** Buttons row at the bottom. */
  readonly actions?: ReactNode;
  /** Element to focus first; defaults to the first focusable control in the body. */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  readonly size?: 'normal' | 'wide';
  /** `alertdialog` for destructive confirmations. */
  readonly role?: 'dialog' | 'alertdialog';
  /** Set false while a save is running so Esc/backdrop can't drop the user's work. */
  readonly dismissible?: boolean;
}

/** Real tab stops only: roving items (tabindex -1) and anything inside an inert subtree are skipped. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.closest('[inert]'));
}

/** Modal dialog: focus moves in and is trapped, Esc and the backdrop close it, focus returns on close. */
export function Dialog({ open, onClose, title, description, children, actions, initialFocus, size = 'normal', role = 'dialog', dismissible = true }: DialogProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('root');
    appRoot?.setAttribute('inert', '');
    const frame = requestAnimationFrame(() => {
      const root = panel.current;
      if (!root) return;
      const target = initialFocus?.current ?? focusables(root).find((el) => !el.dataset.dialogClose) ?? root;
      target.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      appRoot?.removeAttribute('inert');
      previous?.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (dismissible) onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = focusables(panel.current);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="rt-dialog-layer" onKeyDown={onKeyDown}>
      <div className="rt-dialog-scrim" aria-hidden onClick={() => dismissible && onCloseRef.current()} />
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cx('rt-dialog', 'rt-materialize', size === 'wide' && 'rt-dialog--wide')}
      >
        <div className="rt-dialog__head">
          <div>
            <h2 id={`${id}-title`} className="rt-dialog__title">{title}</h2>
            {description ? <p id={`${id}-desc`} className="rt-dialog__description">{description}</p> : null}
          </div>
          <IconButton label="Close" icon={X} variant="plain" tooltip={false} data-dialog-close="true" onClick={() => onCloseRef.current()} disabled={!dismissible} />
        </div>
        {children ? <div className="rt-dialog__body">{children}</div> : null}
        {actions ? <div className="rt-dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
