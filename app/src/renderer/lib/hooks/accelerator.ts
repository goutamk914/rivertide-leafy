/** Formats Electron accelerators ("CommandOrControl+Shift+Space") for people to read. */

export type Platform = 'darwin' | 'win32' | 'linux';

const MAC_MODIFIERS: Readonly<Record<string, string>> = {
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  command: '⌘',
  cmd: '⌘',
  super: '⌘',
  meta: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  altgr: '⌥',
  shift: '⇧',
};

const PC_MODIFIERS: Readonly<Record<string, string>> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  command: 'Ctrl',
  cmd: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  super: 'Win',
  meta: 'Win',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
};

/** Apple's canonical modifier order. */
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

const KEY_NAMES: Readonly<Record<string, string>> = {
  space: 'Space',
  return: '↵',
  enter: '↵',
  escape: 'Esc',
  esc: 'Esc',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  backspace: '⌫',
  delete: '⌦',
  tab: 'Tab',
  plus: '+',
};

function keyLabel(key: string): string {
  const named = KEY_NAMES[key.toLowerCase()];
  if (named) return named;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** "CommandOrControl+Shift+Space" → "⌘⇧Space" on macOS, "Ctrl+Shift+Space" elsewhere. */
export function formatAccelerator(accelerator: string, platform: Platform = 'darwin'): string {
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  const table = platform === 'darwin' ? MAC_MODIFIERS : PC_MODIFIERS;
  const modifiers = parts.filter((p) => table[p.toLowerCase()] !== undefined).map((p) => table[p.toLowerCase()]);
  const keys = parts.filter((p) => table[p.toLowerCase()] === undefined).map(keyLabel);
  if (platform === 'darwin') {
    const ordered = [...new Set(modifiers)].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return [...ordered, ...keys].join('');
  }
  return [...new Set(modifiers), ...keys].join('+');
}

/** The paste shortcut people should press when automatic paste failed. */
export function pasteShortcut(platform: Platform = 'darwin'): string {
  return platform === 'darwin' ? '⌘V' : 'Ctrl+V';
}
