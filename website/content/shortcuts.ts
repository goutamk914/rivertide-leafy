/** Every way to start Rivertide from the keyboard (or your hands). Mirrors docs/ARCHITECTURE.md §2 and §3.6. */

export interface Shortcut {
  /** Keys pressed together. A single entry may be a phrase, e.g. "Clap twice". */
  readonly keys: readonly string[];
  /** Shown between keys; "then" for a double press. */
  readonly joiner?: '+' | 'then';
  readonly action: string;
  readonly detail: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['fn'], action: 'Dictate', detail: 'Hold while you talk. Let go and the clean text is typed for you.' },
  { keys: ['fn', 'fn'], joiner: 'then', action: 'Hands-free dictation', detail: 'Press twice quickly. Press once more to finish.' },
  { keys: ['ctrl', 'fn'], action: 'Ask', detail: 'Ask a question. The answer is typed where you are.' },
  { keys: ['shift', 'fn'], action: 'Tell Leafy', detail: 'Say what you want done: open, find, set, remind.' },
  { keys: ['⌘', '⇧', 'Space'], action: 'Leafy palette', detail: 'Search apps, files, notes and history from anywhere.' },
  { keys: ['⌘', '⇧', 'L'], action: 'Voice command', detail: 'Start talking to Leafy without the fn key.' },
  { keys: ['Clap twice'], action: 'Summon Leafy', detail: 'Optional. Off until you turn it on. Sound never leaves your Mac.' },
  { keys: ['esc'], action: 'Cancel', detail: 'Stops whatever is listening, thinking or acting.' },
];
