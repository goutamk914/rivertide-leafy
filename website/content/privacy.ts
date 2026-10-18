/**
 * Where each kind of data goes. Must match the app: docs/ARCHITECTURE.md §3.3, §3.8, §3.10, §3.12.
 * If the app changes, change this file in the same pull request.
 */

export interface DataFlow {
  readonly what: string;
  readonly where: string;
  /** Plain-language note on the local option or the limit. */
  readonly note: string;
  /** True when this never leaves the Mac in any configuration. */
  readonly localOnly?: boolean;
}

export const DATA_FLOWS: readonly DataFlow[] = [
  {
    what: 'Your voice',
    where: 'The speech provider you choose: Groq, OpenAI or your own endpoint.',
    note: 'Or transcribe on your Mac with whisper.cpp. Recordings are not kept unless you turn that on.',
  },
  {
    what: 'The words, for polishing and answers',
    where: 'The AI provider you choose: Claude, Groq, OpenAI or OpenRouter.',
    note: 'Or run a model on your Mac with Ollama, and nothing leaves it.',
  },
  {
    what: 'Clap detection',
    where: 'Nowhere. Listened to on your Mac only.',
    note: 'Off until you turn it on. Never recorded, never sent.',
    localOnly: true,
  },
  {
    what: 'History, notes, facts, documents',
    where: 'Files in your Mac’s Application Support folder.',
    note: 'Export or wipe all of it from Settings, Privacy.',
    localOnly: true,
  },
  {
    what: 'Your API keys',
    where: 'Encrypted on your Mac with Electron safeStorage, backed by the macOS Keychain.',
    note: 'Only the part of the app that calls the provider can read them.',
    localOnly: true,
  },
  {
    what: 'Code the Cure servers',
    where: 'Not involved. There is no Rivertide account.',
    note: 'We cannot see what you say, and we do not want to.',
    localOnly: true,
  },
];

export interface Permission {
  readonly name: string;
  readonly why: string;
  readonly when: string;
}

export const PERMISSIONS: readonly Permission[] = [
  {
    name: 'Microphone',
    why: 'To hear you while you hold fn, ask a question or talk to Leafy, and to listen for a double clap if you turn that on.',
    when: 'Asked the first time you dictate. macOS shows its orange dot whenever the microphone is in use.',
  },
  {
    name: 'Accessibility',
    why: 'To paste the cleaned text where your cursor is, and to read the selected text when you ask about it.',
    when: 'Asked during setup. Without it, text stays on the clipboard for you to paste.',
  },
  {
    name: 'Input Monitoring',
    why: 'To notice the fn key being held. Rivertide listens for fn and its modifiers only, and never records what you type.',
    when: 'Some Macs ask for it alongside Accessibility.',
  },
  {
    name: 'Automation',
    why: 'So Leafy can do what you ask in other apps: open a note, run a Shortcut, change a setting.',
    when: 'macOS asks per app, the first time Leafy controls it. You can say no and keep everything else.',
  },
];
