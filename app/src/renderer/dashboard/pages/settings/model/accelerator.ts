/**
 * Pure helpers for the shortcut fields: turn a keydown into an Electron accelerator
 * ("CommandOrControl+Shift+K"), compare accelerators, and describe registration status.
 */
import type { HotkeyStatus } from '@shared/types';

export type Platform = 'darwin' | 'win32' | 'linux';
export type HotkeyAction = HotkeyStatus['action'];
export type Modifier = 'CommandOrControl' | 'Control' | 'Super' | 'Alt' | 'Shift';

/** The parts of a KeyboardEvent the capture logic reads (easy to fake in tests). */
export interface KeyLike {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export type CaptureResult =
  | { readonly kind: 'pass' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'pending'; readonly modifiers: readonly Modifier[] }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ok'; readonly accelerator: string };

export const HOTKEY_ACTIONS: readonly { readonly id: HotkeyAction; readonly label: string; readonly description: string }[] = [
  { id: 'palette', label: 'Open the palette', description: 'Search apps, files and notes, or ask Leafy.' },
  { id: 'command', label: 'Start a Leafy command', description: 'Say what you want done, and Leafy does it.' },
  { id: 'dictate', label: 'Start or stop dictation', description: 'For keyboards without fn, or when fn is off.' },
];

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'FnLock', 'AltGraph', 'OS', 'Hyper', 'Super',
]);

const NAMED_CODES: Readonly<Record<string, string>> = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};

const ALIASES: Readonly<Record<string, string>> = {
  cmdorctrl: 'commandorcontrol', command: 'cmd', option: 'alt', ctrl: 'control', return: 'enter', esc: 'escape',
};
const CANONICAL_MODIFIERS: ReadonlySet<string> = new Set(['commandorcontrol', 'cmd', 'control', 'alt', 'shift', 'super', 'meta', 'altgr']);

const UNSUPPORTED_KEY = 'That key can’t be part of a shortcut. Try a letter, a number or an F key.';
const SHIFT_ONLY = 'Shift alone would get in the way of typing. Add another modifier key too.';

function needsModifierMessage(platform: Platform): string {
  return platform === 'darwin'
    ? 'Hold Command, Control, Option or Shift, then press a key.'
    : 'Hold Ctrl, Alt or Shift, then press a key.';
}

function heldModifiers(event: KeyLike, platform: Platform): Modifier[] {
  const mac = platform === 'darwin';
  const held: [boolean, Modifier][] = [
    [mac ? event.metaKey : event.ctrlKey, 'CommandOrControl'],
    [mac && event.ctrlKey, 'Control'],
    [!mac && event.metaKey, 'Super'],
    [event.altKey, 'Alt'],
    [event.shiftKey, 'Shift'],
  ];
  return held.filter(([down]) => down).map(([, name]) => name);
}

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_CODES[code] ?? null;
}

function keyFromValue(key: string): string | null {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (key === ' ') return 'Space';
  return null;
}

/** A key that types a character, so Shift+key would steal capitals or symbols. */
function isTypingKey(key: string): boolean {
  return key.length === 1 || key === 'Space';
}

/** Interprets one keydown inside a shortcut field. */
export function captureAccelerator(event: KeyLike, platform: Platform): CaptureResult {
  if (event.key === 'Escape') return { kind: 'cancel' };
  if (event.key === 'Backspace' || event.key === 'Delete') return { kind: 'clear' };
  const modifiers = heldModifiers(event, platform);
  if (event.key === 'Tab' && modifiers.every((m) => m === 'Shift')) return { kind: 'pass' };
  if (MODIFIER_KEYS.has(event.key)) return { kind: 'pending', modifiers };
  const key = (event.code ? keyFromCode(event.code) : null) ?? keyFromValue(event.key);
  if (!key) return { kind: 'invalid', message: UNSUPPORTED_KEY };
  if (modifiers.length === 0) return { kind: 'invalid', message: needsModifierMessage(platform) };
  if (modifiers.every((m) => m === 'Shift') && isTypingKey(key)) return { kind: 'invalid', message: SHIFT_ONLY };
  return { kind: 'ok', accelerator: [...modifiers, key].join('+') };
}

/** Lower-cased, alias-free form with modifiers sorted, for comparisons. */
function canonical(accelerator: string): string {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => ALIASES[p] ?? p);
  const modifiers = parts.filter((p) => CANONICAL_MODIFIERS.has(p)).sort();
  const keys = parts.filter((p) => !CANONICAL_MODIFIERS.has(p));
  return [...modifiers, ...keys].join('+');
}

export function sameAccelerator(a: string, b: string): boolean {
  const left = canonical(a);
  return left.length > 0 && left === canonical(b);
}

/** ChatGPT and Codex own Option+Space; registering it usually fails or fights them. */
export function usesOptionSpace(accelerator: string): boolean {
  return sameAccelerator(accelerator, 'Alt+Space');
}

/** The other action already using `accelerator`, if any. */
export function findConflict(
  accelerator: string,
  action: HotkeyAction,
  current: Readonly<Record<HotkeyAction, string>>,
): HotkeyAction | null {
  if (!accelerator.trim()) return null;
  const other = HOTKEY_ACTIONS.find(({ id }) => id !== action && sameAccelerator(current[id], accelerator));
  return other ? other.id : null;
}

export function actionLabel(action: HotkeyAction): string {
  return HOTKEY_ACTIONS.find((a) => a.id === action)?.label ?? action;
}

export type HotkeyTone = 'ready' | 'off' | 'conflict' | 'checking';

/** What to show under a shortcut field, from main's `hotkeys:status`. */
export function hotkeyStatusLine(
  statuses: readonly HotkeyStatus[] | undefined,
  action: HotkeyAction,
  accelerator: string,
): { readonly tone: HotkeyTone; readonly text: string } {
  if (!accelerator.trim()) return { tone: 'off', text: 'Off. No shortcut is set.' };
  const status = statuses?.find((s) => s.action === action);
  if (!status || !sameAccelerator(status.accelerator, accelerator)) return { tone: 'checking', text: 'Checking…' };
  return status.registered
    ? { tone: 'ready', text: 'Ready' }
    : { tone: 'conflict', text: 'Another app is using this shortcut. Pick a different one.' };
}
