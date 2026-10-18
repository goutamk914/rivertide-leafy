/**
 * Leafy's tools as people see them in Settings (ids and risk levels from docs/ARCHITECTURE.md §3.9).
 * Main enforces the policy; this list only explains it and edits `agent.toolPolicy`.
 */
import type { BadgeTone } from '../../../../ui/components';

export type ToolRisk = 'read' | 'act' | 'confirm';
export type ToolPolicy = 'always' | 'ask' | 'never';
export type ToolPolicies = Readonly<Record<string, ToolPolicy>>;

export interface AgentToolInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  /** Reaches the internet; turned off with "Allow tools that use the internet". */
  readonly network: boolean;
}

const tool = (id: string, name: string, description: string, risk: ToolRisk, network = false): AgentToolInfo => ({
  id, name, description, risk, network,
});

export const AGENT_TOOLS: readonly AgentToolInfo[] = [
  tool('open_app', 'Open apps', 'Opens an app, like Calendar or Mail.', 'act'),
  tool('quit_app', 'Quit apps', 'Quits an app you name.', 'confirm'),
  tool('open_url', 'Open web pages', 'Opens a link in your browser.', 'act', true),
  tool('web_search', 'Search the web', 'Looks something up online.', 'read', true),
  tool('search_files', 'Find files', 'Searches for files on this computer.', 'read'),
  tool('open_file', 'Open files', 'Opens a file it found.', 'act'),
  tool('reveal_file', 'Show files in their folder', 'Shows where a file is kept.', 'act'),
  tool('get_system_status', 'Check the time and battery', 'Reads the time, date, battery, volume and light or dark mode.', 'read'),
  tool('set_volume', 'Change the volume', 'Turns the sound up, down or off.', 'act'),
  tool('set_dark_mode', 'Switch light or dark mode', 'Changes how your computer looks.', 'act'),
  tool('media_control', 'Control music and video', 'Plays, pauses and skips.', 'act'),
  tool('lock_screen', 'Lock the screen', 'Locks your computer.', 'confirm'),
  tool('sleep_display', 'Turn off the display', 'Puts the screen to sleep.', 'confirm'),
  tool('take_screenshot', 'Take screenshots', 'Saves a picture of your screen.', 'act'),
  tool('set_timer', 'Set timers', 'Starts a timer.', 'act'),
  tool('create_reminder', 'Add reminders', 'Sets a reminder for later.', 'act'),
  tool('list_reminders', 'List reminders', 'Reads your upcoming reminders.', 'read'),
  tool('cancel_reminder', 'Cancel reminders', 'Removes a reminder or timer.', 'act'),
  tool('create_note', 'Write notes', 'Saves a new note.', 'act'),
  tool('search_notes', 'Search notes', 'Looks through your notes.', 'read'),
  tool('remember_fact', 'Remember things about you', 'Saves a fact to Memory.', 'act'),
  tool('recall_facts', 'Recall what it remembers', 'Reads facts from Memory.', 'read'),
  tool('search_documents', 'Search documents', 'Looks through documents you imported.', 'read'),
  tool('search_history', 'Search history', 'Looks through what you said before.', 'read'),
  tool('copy_to_clipboard', 'Copy text', 'Puts text on the clipboard.', 'act'),
  tool('read_clipboard', 'Read the clipboard', 'Reads what you last copied.', 'read'),
  tool('type_text', 'Type for you', 'Types text into the app you are using.', 'confirm'),
  tool('compose_email', 'Start emails', 'Opens a new email draft. It never sends.', 'act'),
  tool('run_shortcut', 'Run Shortcuts', 'Runs one of your Shortcuts from the Shortcuts app.', 'confirm'),
  tool('list_shortcuts', 'List Shortcuts', 'Reads the names of your Shortcuts.', 'read'),
  tool('open_system_settings', 'Open System Settings', 'Opens a page of System Settings.', 'act'),
  tool('open_rivertide', 'Open Rivertide pages', 'Opens a page of this dashboard.', 'act'),
  tool('get_weather', 'Check the weather', 'Gets the forecast from Open-Meteo. No account needed.', 'read', true),
];

export const RISK_INFO: Readonly<Record<ToolRisk, { readonly label: string; readonly group: string; readonly tone: BadgeTone }>> = {
  read: { label: 'Looks things up', group: 'Looks things up', tone: 'neutral' },
  act: { label: 'Does things', group: 'Does things for you', tone: 'info' },
  confirm: { label: 'Needs a yes', group: 'Needs your yes first', tone: 'warn' },
};

export const RISK_ORDER: readonly ToolRisk[] = ['read', 'act', 'confirm'];

export const POLICY_LABELS: Readonly<Record<ToolPolicy, string>> = {
  always: 'Always',
  ask: 'Ask first',
  never: 'Never',
};

export function findTool(id: string): AgentToolInfo | undefined {
  return AGENT_TOOLS.find((t) => t.id === id);
}

export function toolsByRisk(risk: ToolRisk): readonly AgentToolInfo[] {
  return AGENT_TOOLS.filter((t) => t.risk === risk);
}

/** What main does when the user hasn't chosen: read/act run, confirm asks. */
export function defaultPolicy(risk: ToolRisk): ToolPolicy {
  return risk === 'confirm' ? 'ask' : 'always';
}

export function effectivePolicy(info: AgentToolInfo, policies: ToolPolicies): ToolPolicy {
  return policies[info.id] ?? defaultPolicy(info.risk);
}

/**
 * New policy record with `value` for `info`. Choosing the default removes the override,
 * so future changes to the default still apply. Unknown keys are kept as they are.
 */
export function withToolPolicy(policies: ToolPolicies, info: AgentToolInfo, value: ToolPolicy): Record<string, ToolPolicy> {
  const rest = Object.fromEntries(Object.entries(policies).filter(([id]) => id !== info.id));
  return value === defaultPolicy(info.risk) ? rest : { ...rest, [info.id]: value };
}
