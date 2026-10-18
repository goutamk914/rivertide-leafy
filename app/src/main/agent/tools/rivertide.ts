/** Rivertide's own surfaces: open_rivertide (dashboard pages) and start_dictation. */
import { z } from 'zod';
import { defineTool, ok } from './types';

export const RIVERTIDE_PAGES = {
  home: { route: '/', label: 'Rivertide' },
  history: { route: '/history', label: 'your history' },
  chat: { route: '/chat', label: 'chat' },
  knowledge: { route: '/knowledge', label: 'your knowledge' },
  documents: { route: '/documents', label: 'your documents' },
  notes: { route: '/notes', label: 'notes and reminders' },
  insights: { route: '/insights', label: 'your insights' },
  settings: { route: '/settings', label: 'Rivertide settings' },
} as const;
export type RivertidePage = keyof typeof RIVERTIDE_PAGES;
const PAGE_NAMES = Object.keys(RIVERTIDE_PAGES) as [RivertidePage, ...RivertidePage[]];

/** Delay so the current voice session can finish before dictation starts listening. */
export const DICTATION_START_DELAY_MS = 500;

export const openRivertideTool = defineTool({
  name: 'open_rivertide',
  description: 'Open a page of the Rivertide dashboard: home, history, chat, knowledge, documents, notes (and reminders), insights or settings.',
  risk: 'act',
  schema: z.object({ page: z.enum(PAGE_NAMES) }),
  title: ({ page }) => `Open ${RIVERTIDE_PAGES[page].label}`,
  async run({ page }, context) {
    context.app.windows.dashboard.show(RIVERTIDE_PAGES[page].route);
    return ok(`Opened ${RIVERTIDE_PAGES[page].label}.`);
  },
});

export const startDictationTool = defineTool({
  name: 'start_dictation',
  description: 'Start a hands-free dictation: Rivertide listens and types what the person says at their cursor.',
  risk: 'act',
  schema: z.object({}),
  title: () => 'Start dictation',
  async run(_input, context) {
    setTimeout(() => context.app.voice.start('dictate', 'leafy'), DICTATION_START_DELAY_MS);
    return ok('Okay, I’m listening.');
  },
});
