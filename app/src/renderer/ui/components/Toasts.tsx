import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { platform } from '../../lib/ipc';
import { Button, ICON_STROKE, IconButton } from './Button';
import { cx } from './cx';
import { Kbd } from './Kbd';
import { useToastStore, type ToastItem } from './toast-store';

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert } as const;

function isMac(): boolean {
  try {
    return platform() === 'darwin';
  } catch {
    return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  }
}

/** True when the keystroke belongs to a text field (where ⌘Z is the field's own undo). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** ⌘Z (macOS) / Ctrl+Z elsewhere runs the newest Undo toast when focus isn't in a text field. */
function useUndoShortcut(): void {
  const undoLatest = useToastStore((s) => s.undoLatest);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z' || isEditableTarget(event.target)) return;
      if (undoLatest()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoLatest]);
}

function ToastAction({ toast, mac }: { readonly toast: ToastItem; readonly mac: boolean }) {
  const close = useToastStore((s) => s.close);
  const action = toast.action;
  if (!action) return null;
  const isUndo = action.shortcut === 'undo';
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-keyshortcuts={isUndo ? (mac ? 'Meta+Z' : 'Control+Z') : undefined}
      onClick={() => {
        action.onClick();
        close(toast.id, 'action');
      }}
    >
      {action.label}
      {/* Shown for sighted users; screen readers get aria-keyshortcuts and the hint in the message. */}
      {isUndo ? <span aria-hidden><Kbd className="rt-toast__kbd">{mac ? '⌘Z' : 'Ctrl+Z'}</Kbd></span> : null}
    </Button>
  );
}

function ToastView({ toast, mac }: { readonly toast: ToastItem; readonly mac: boolean }) {
  const close = useToastStore((s) => s.close);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(0);

  useEffect(() => {
    if (remaining.current === null || paused) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(() => close(toast.id, 'timeout'), remaining.current);
    return () => {
      clearTimeout(timer);
      if (remaining.current !== null) remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, close, toast.id]);

  const Icon = ICONS[toast.kind];
  const undoHint = toast.action?.shortcut === 'undo' ? ` Press ${mac ? 'Command' : 'Control'} Z to undo.` : '';
  return (
    <div
      className={cx('rt-toast', 'rt-materialize', `rt-toast--${toast.kind}`)}
      role={toast.kind === 'error' ? 'alert' : undefined}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="rt-toast__icon"><Icon size={18} strokeWidth={ICON_STROKE} aria-hidden /></span>
      <p className="rt-toast__message">
        {toast.message}
        {undoHint ? <span className="visually-hidden">{undoHint}</span> : null}
      </p>
      <div className="rt-toast__actions">
        <ToastAction toast={toast} mac={mac} />
        <IconButton label="Dismiss" icon={X} size="sm" variant="plain" tooltip={false} onClick={() => close(toast.id, 'dismissed')} />
      </div>
    </div>
  );
}

/**
 * Bottom-right live region, portalled to <body> so it stays usable while a dialog makes #root inert.
 * Never steals focus; errors stay until dismissed; hover or focus pauses timers; ⌘Z runs Undo.
 */
export function ToastRegion() {
  const toasts = useToastStore((s) => s.toasts);
  const mac = isMac();
  useUndoShortcut();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <section className="rt-toasts" aria-label="Notifications" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} mac={mac} />
      ))}
    </section>,
    document.body,
  );
}
