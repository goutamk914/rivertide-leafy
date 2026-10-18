/**
 * Built-in palette commands (`cmd:*`). Each either opens a dashboard route or runs an action and
 * returns a short confirmation for the palette to show.
 */
import type { AppContext } from '../services';

export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly keywords: readonly string[];
  /** Hide the palette before running (voice capture must see the app the user came from). */
  readonly hideFirst?: boolean;
  readonly route?: string;
  readonly available?: (ctx: AppContext) => boolean;
  readonly run?: (ctx: AppContext) => Promise<string | null> | string | null;
}

/** Dashboard routes the palette opens. Items open with their id appended, e.g. `/notes/<id>`. */
export const ROUTES = {
  today: '/',
  history: '/history',
  chat: '/chat',
  knowledge: '/knowledge',
  documents: '/documents',
  insights: '/insights',
  settings: '/settings',
  notes: '/notes',
  newNote: '/notes/new',
  reminders: '/notes/reminders',
} as const;

const route = (id: string, title: string, icon: string, path: string, keywords: readonly string[]): PaletteCommand => ({
  id: `cmd:${id}`, title, subtitle: 'Open in Rivertide', icon: `icon:${icon}`, keywords, route: path,
});

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  {
    id: 'cmd:dictate', title: 'Start dictation', subtitle: 'Speak, and Rivertide types it for you', icon: 'icon:mic',
    keywords: ['dictate', 'dictation', 'type', 'write', 'speak', 'voice'], hideFirst: true,
    run: (ctx) => {
      ctx.voice.start('dictate', 'palette');
      return null;
    },
  },
  {
    id: 'cmd:talk', title: 'Talk to Leafy', subtitle: 'Ask Leafy to do something by voice', icon: 'icon:leaf',
    keywords: ['leafy', 'talk', 'voice', 'command', 'assistant', 'jarvis'], hideFirst: true,
    run: (ctx) => {
      ctx.voice.start('command', 'palette');
      return null;
    },
  },
  { ...route('new-note', 'New note', 'notebook-pen', ROUTES.newNote, ['note', 'write', 'jot', 'memo']), subtitle: 'Write something down' },
  {
    id: 'cmd:timer-5', title: 'Set a 5-minute timer', subtitle: 'Leafy lets you know when it is done', icon: 'icon:timer',
    keywords: ['timer', 'five minutes', '5 minutes', 'countdown', 'alarm'],
    run: (ctx) => {
      ctx.reminders.create({ kind: 'timer', text: '5-minute timer', inMinutes: 5 });
      return 'Timer set for 5 minutes.';
    },
  },
  route('open-today', 'Open Today', 'sun', ROUTES.today, ['home', 'today', 'dashboard']),
  route('open-history', 'Open History', 'history', ROUTES.history, ['history', 'past', 'dictations']),
  route('open-chat', 'Open Chat', 'message-circle', ROUTES.chat, ['chat', 'conversation', 'talk']),
  route('open-knowledge', 'Open Knowledge', 'brain', ROUTES.knowledge, ['knowledge', 'facts', 'memory', 'dictionary', 'graph']),
  route('open-documents', 'Open Documents', 'file-text', ROUTES.documents, ['documents', 'files', 'records', 'pdf']),
  route('open-insights', 'Open Insights', 'gauge', ROUTES.insights, ['insights', 'stats', 'fog', 'speech']),
  route('open-settings', 'Open Settings', 'settings', ROUTES.settings, ['settings', 'preferences', 'options']),
  {
    id: 'cmd:leafy-show', title: 'Show Leafy', subtitle: 'Bring Leafy back on screen', icon: 'icon:leaf',
    keywords: ['leafy', 'show', 'pet', 'sprout'],
    available: (ctx) => !ctx.settings.get().leafy.visible,
    run: (ctx) => {
      ctx.settings.update({ leafy: { visible: true } });
      ctx.windows.leafy.show();
      return 'Leafy is back.';
    },
  },
  {
    id: 'cmd:leafy-hide', title: 'Hide Leafy', subtitle: 'You can bring Leafy back from here or the menu bar', icon: 'icon:leaf',
    keywords: ['leafy', 'hide', 'pet', 'sprout'],
    available: (ctx) => ctx.settings.get().leafy.visible,
    run: (ctx) => {
      ctx.settings.update({ leafy: { visible: false } });
      ctx.windows.leafy.hide();
      return 'Leafy is hidden.';
    },
  },
  {
    id: 'cmd:clap-on', title: 'Turn clap detection on', subtitle: 'Double-clap to call Leafy', icon: 'icon:zap',
    keywords: ['clap', 'hands-free', 'double clap'],
    available: (ctx) => !ctx.settings.get().clap.enabled,
    run: (ctx) => {
      ctx.settings.update({ clap: { enabled: true } });
      return 'Clap detection is on. Double-clap to call Leafy.';
    },
  },
  {
    id: 'cmd:clap-off', title: 'Turn clap detection off', subtitle: 'Stop listening for claps', icon: 'icon:zap',
    keywords: ['clap', 'hands-free', 'double clap'],
    available: (ctx) => ctx.settings.get().clap.enabled,
    run: (ctx) => {
      ctx.settings.update({ clap: { enabled: false } });
      return 'Clap detection is off.';
    },
  },
  {
    id: 'cmd:wake-on', title: 'Turn “Hey Leafy” on', subtitle: 'Say “Hey Leafy” to call Leafy', icon: 'icon:mic',
    keywords: ['hey leafy', 'wake word', 'hands-free', 'listen'],
    available: (ctx) => !ctx.settings.get().wakeWord.enabled,
    run: (ctx) => {
      ctx.settings.update({ wakeWord: { enabled: true } });
      return '“Hey Leafy” is on. Say it any time to call Leafy.';
    },
  },
  {
    id: 'cmd:wake-off', title: 'Turn “Hey Leafy” off', subtitle: 'Stop listening for “Hey Leafy”', icon: 'icon:mic',
    keywords: ['hey leafy', 'wake word', 'hands-free', 'listen'],
    available: (ctx) => ctx.settings.get().wakeWord.enabled,
    run: (ctx) => {
      ctx.settings.update({ wakeWord: { enabled: false } });
      return '“Hey Leafy” is off.';
    },
  },
];

export function findCommand(id: string): PaletteCommand | null {
  return PALETTE_COMMANDS.find((command) => command.id === id) ?? null;
}
