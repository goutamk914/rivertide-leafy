/** Pure keyboard model for the palette: key → command, active-row reducer, Esc resolution. */

export type PaletteCommand =
  | { readonly type: 'move'; readonly delta: 1 | -1 }
  | { readonly type: 'execute'; readonly alt: boolean }
  | { readonly type: 'quick'; readonly index: number; readonly alt: boolean }
  | { readonly type: 'jump-ask' }
  | { readonly type: 'escape' };

export interface KeyLike {
  readonly key: string;
  /** Physical key ("Digit3"); used for quick picks because ⌥3 types "£" on a Mac. */
  readonly code?: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
}

/** Maps a keydown to a palette command (null = let the input handle it). */
export function commandForKey(event: KeyLike, isMac = true): PaletteCommand | null {
  if (event.isComposing) return null;
  const quickModifier = isMac ? event.metaKey : event.ctrlKey;
  const digit = /^Digit([1-9])$/.exec(event.code ?? '')?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null);
  if (quickModifier && digit) {
    return { type: 'quick', index: Number(digit) - 1, alt: event.altKey };
  }
  switch (event.key) {
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case 'Enter':
      return { type: 'execute', alt: event.altKey };
    case 'Tab':
      return event.shiftKey ? null : { type: 'jump-ask' };
    case 'Escape':
      return { type: 'escape' };
    default:
      break;
  }
  if (event.ctrlKey && !event.metaKey && (event.key === 'n' || event.key === 'p')) {
    return { type: 'move', delta: event.key === 'n' ? 1 : -1 };
  }
  return null;
}

export interface KeyContext {
  readonly view: PaletteView;
  readonly resultCount: number;
  readonly hasAskRow: boolean;
}

/**
 * Whether the palette acts on a command right now. Anything it would not act on keeps the
 * browser default, so Tab still moves focus to the chips and buttons and arrows still scroll.
 */
export function handlesCommand(command: PaletteCommand, context: KeyContext): boolean {
  switch (command.type) {
    case 'move':
      return context.view === 'search' && context.resultCount > 0;
    case 'jump-ask':
      return context.view === 'search' && context.hasAskRow;
    case 'quick':
      return context.view === 'search';
    default:
      return true;
  }
}

/** Moves the active row without wrapping (calmer than jumping from bottom to top). */
export function moveActive(active: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, active + delta));
}

export function clampActive(active: number, count: number): number {
  return moveActive(active, 0, count);
}

export type PaletteView = 'search' | 'ask' | 'voice';

export type EscapeAction = 'cancel-run' | 'cancel-voice' | 'back-to-search' | 'clear' | 'hide';

export interface EscapeContext {
  readonly view: PaletteView;
  readonly query: string;
  /** An agent run (ask view) or voice session (voice view) is still in flight. */
  readonly busy: boolean;
}

/** Esc peels back one layer at a time: stop what's running, then leave Ask, then clear, then hide. */
export function resolveEscape({ view, query, busy }: EscapeContext): EscapeAction {
  if (view === 'ask') return busy ? 'cancel-run' : 'back-to-search';
  if (view === 'voice') return busy ? 'cancel-voice' : 'back-to-search';
  return query.length > 0 ? 'clear' : 'hide';
}

/** Y / N answer a pending confirmation, but only while the input is empty (so typing "yes" works too). */
export function confirmKey(key: string, inputEmpty: boolean): boolean | null {
  if (!inputEmpty) return null;
  const lower = key.toLowerCase();
  if (lower === 'y') return true;
  if (lower === 'n') return false;
  return null;
}
