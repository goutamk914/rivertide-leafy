import type { Settings } from '@shared/settings';
import { formatAccelerator, type Platform } from '../lib/hooks/accelerator';
import { keepInputFocus } from './PaletteHeader';

export const SUGGESTIONS: readonly string[] = [
  'Open Calendar',
  'Set a timer for 10 minutes',
  'What did I note about my last appointment?',
  'Find my scan results',
];

export interface ShortcutHint {
  readonly keys: string;
  readonly label: string;
}

/** Pure: the shortcuts worth showing for these settings and this OS. */
export function shortcutHints(settings: Settings | null, platform: Platform): readonly ShortcutHint[] {
  const hotkeys = settings?.hotkeys;
  const fn = platform === 'darwin' && (hotkeys?.useFn ?? true);
  const hints: ShortcutHint[] = fn
    ? [
        { keys: 'fn', label: 'Dictate' },
        { keys: '⌃ fn', label: 'Ask' },
        { keys: '⇧ fn', label: 'Command' },
      ]
    : [
        { keys: formatAccelerator(hotkeys?.dictate ?? 'CommandOrControl+Shift+D', platform), label: 'Dictate' },
        { keys: formatAccelerator(hotkeys?.command ?? 'CommandOrControl+Shift+L', platform), label: 'Command' },
      ];
  hints.push({ keys: formatAccelerator(hotkeys?.palette ?? 'CommandOrControl+Shift+Space', platform), label: 'This palette' });
  if (settings?.clap.enabled) hints.push({ keys: 'Clap twice', label: 'Call Leafy' });
  if (settings?.wakeWord.enabled) hints.push({ keys: 'Say “Hey Leafy”', label: 'Call Leafy' });
  return hints;
}

export interface EmptyStateProps {
  readonly name: string;
  readonly hints: readonly ShortcutHint[];
  readonly onSuggest: (text: string) => void;
}

/** What the palette shows before you type: a hello, four things to try, and the shortcuts. */
export function EmptyState({ name, hints, onSuggest }: EmptyStateProps) {
  const first = name.trim().split(/\s+/)[0];
  return (
    <section className="pl-empty pl-enter" aria-label="Suggestions">
      <p className="pl-empty__hello">
        {first ? `Hi ${first}.` : 'Hi there.'} <span className="pl-empty__beat">What can I do for you?</span>
      </p>
      <div className="pl-chips">
        {SUGGESTIONS.map((text) => (
          <button key={text} type="button" className="pl-chip" onMouseDown={keepInputFocus} onClick={() => onSuggest(text)}>
            {text}
          </button>
        ))}
      </div>
      <ul className="pl-shortcuts" aria-label="Shortcuts">
        {hints.map((hint) => (
          <li key={hint.label}>
            <kbd className="pl-kbd">{hint.keys}</kbd>
            <span>{hint.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
