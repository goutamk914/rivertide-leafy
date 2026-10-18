/** Toast queue shared by every component in a window. Errors stay until dismissed. */
import { create } from 'zustand';

export const TOAST_DEFAULT_MS = 5000;
const MAX_TOASTS = 4;

export type ToastKind = 'info' | 'success' | 'error';
export type ToastCloseReason = 'timeout' | 'dismissed' | 'action';

export interface ToastInput {
  readonly kind: ToastKind;
  readonly message: string;
  /** One action, e.g. Undo or Retry. `shortcut: 'undo'` also binds ⌘Z / Ctrl+Z outside text fields. */
  readonly action?: { readonly label: string; readonly onClick: () => void; readonly shortcut?: 'undo' };
  /** null keeps it until dismissed. Defaults: errors null, others 5 s. */
  readonly durationMs?: number | null;
  readonly onClose?: (reason: ToastCloseReason) => void;
}

export interface ToastItem extends ToastInput {
  readonly id: number;
  readonly durationMs: number | null;
}

interface ToastState {
  readonly toasts: readonly ToastItem[];
  readonly push: (toast: ToastInput) => number;
  readonly close: (id: number, reason: ToastCloseReason) => void;
  /** Runs the newest Undo action, if any. Returns true when one ran. */
  readonly undoLatest: () => boolean;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId;
    nextId += 1;
    const durationMs = toast.durationMs !== undefined ? toast.durationMs : toast.kind === 'error' ? null : TOAST_DEFAULT_MS;
    const item: ToastItem = { ...toast, id, durationMs };
    const overflow = get().toasts.length + 1 - MAX_TOASTS;
    const dropped = overflow > 0 ? get().toasts.slice(0, overflow) : [];
    set((state) => ({ toasts: [...state.toasts.slice(Math.max(0, overflow)), item] }));
    dropped.forEach((t) => t.onClose?.('timeout'));
    return id;
  },
  undoLatest: () => {
    const latest = [...get().toasts].reverse().find((t) => t.action?.shortcut === 'undo');
    if (!latest?.action) return false;
    latest.action.onClick();
    get().close(latest.id, 'action');
    return true;
  },
  close: (id, reason) => {
    const toast = get().toasts.find((t) => t.id === id);
    if (!toast) return;
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    toast.onClose?.(reason);
  },
}));

/** Imperative helpers for non-React code paths. */
export const toast = {
  info: (message: string, extra: Partial<ToastInput> = {}) => useToastStore.getState().push({ kind: 'info', message, ...extra }),
  success: (message: string, extra: Partial<ToastInput> = {}) => useToastStore.getState().push({ kind: 'success', message, ...extra }),
  error: (message: string, extra: Partial<ToastInput> = {}) => useToastStore.getState().push({ kind: 'error', message, ...extra }),
  close: (id: number) => useToastStore.getState().close(id, 'dismissed'),
};
