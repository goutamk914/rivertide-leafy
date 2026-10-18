/**
 * Pure icon naming for overlays. Names are lucide's kebab-case names; `Icon.tsx` maps the curated
 * set below to components (importing all of lucide would bloat every window).
 */
import type { SearchKind } from '@shared/types';

export const ICON_NAMES = [
  'app-window', 'battery', 'bell', 'bell-off', 'book-open', 'bookmark-plus', 'brain', 'calculator', 'calendar',
  'camera', 'clipboard', 'clipboard-copy', 'clock', 'cloud-sun', 'command', 'file', 'file-search', 'file-text',
  'folder', 'folder-open', 'gauge', 'globe', 'hash', 'heart', 'history', 'image', 'info', 'keyboard', 'leaf',
  'lightbulb', 'link', 'list', 'list-checks', 'lock', 'mail', 'message-circle', 'mic', 'monitor', 'monitor-off',
  'moon', 'music', 'notebook-pen', 'play', 'power', 'search', 'settings', 'sliders-horizontal', 'sparkles', 'star',
  'sticky-note', 'sun', 'terminal', 'timer', 'trash-2', 'volume-2', 'workflow', 'zap',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const ICON_SET: ReadonlySet<string> = new Set(ICON_NAMES);

export function isIconName(value: string): value is IconName {
  return ICON_SET.has(value);
}

/** "FileText", "fileText", "file_text", "icon:file-text" → "file-text" (or null if unknown). */
export function normalizeIconName(raw: string): IconName | null {
  const bare = raw.trim().replace(/^icon:/i, '');
  const kebab = bare
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
  return isIconName(kebab) ? kebab : null;
}

const TOOL_ICONS: Readonly<Record<string, IconName>> = {
  open_app: 'app-window',
  quit_app: 'power',
  open_url: 'globe',
  web_search: 'search',
  search_files: 'file-search',
  open_file: 'file-text',
  reveal_file: 'folder-open',
  get_system_status: 'gauge',
  set_volume: 'volume-2',
  set_dark_mode: 'moon',
  media_control: 'music',
  lock_screen: 'lock',
  sleep_display: 'monitor-off',
  take_screenshot: 'camera',
  set_timer: 'timer',
  create_reminder: 'bell',
  list_reminders: 'list-checks',
  cancel_reminder: 'bell-off',
  create_note: 'notebook-pen',
  search_notes: 'sticky-note',
  remember_fact: 'bookmark-plus',
  recall_facts: 'lightbulb',
  search_documents: 'file-search',
  search_history: 'history',
  copy_to_clipboard: 'clipboard-copy',
  read_clipboard: 'clipboard',
  type_text: 'keyboard',
  compose_email: 'mail',
  run_shortcut: 'zap',
  list_shortcuts: 'list',
  open_system_settings: 'settings',
  open_rivertide: 'leaf',
  get_weather: 'cloud-sun',
};

/** Fallback guesses from the status line when the tool name is unknown (e.g. local fast-path intents). */
const DETAIL_HINTS: readonly (readonly [RegExp, IconName])[] = [
  [/timer/i, 'timer'],
  [/remind/i, 'bell'],
  [/note/i, 'notebook-pen'],
  [/volume|mute/i, 'volume-2'],
  [/weather/i, 'cloud-sun'],
  [/dark mode|light mode/i, 'moon'],
  [/screenshot/i, 'camera'],
  [/email|mail/i, 'mail'],
  [/search|find|look/i, 'search'],
  [/lock/i, 'lock'],
  [/play|pause|music|song/i, 'music'],
  [/web|site|http/i, 'globe'],
  [/open/i, 'app-window'],
];

export function toolIconName(tool: string | null | undefined, detail?: string | null): IconName {
  if (tool && TOOL_ICONS[tool]) return TOOL_ICONS[tool];
  const hint = detail ? DETAIL_HINTS.find(([pattern]) => pattern.test(detail)) : undefined;
  return hint ? hint[1] : 'sparkles';
}

const SEARCHING_TOOLS: ReadonlySet<string> = new Set([
  'web_search', 'search_files', 'search_notes', 'search_documents', 'search_history', 'recall_facts',
  'list_reminders', 'list_shortcuts', 'read_clipboard', 'get_weather', 'get_system_status',
]);

/** Leafy reads (glasses) while looking things up and types while doing things. */
export function toolActivity(tool: string | null | undefined): 'searching' | 'working' {
  return tool && SEARCHING_TOOLS.has(tool) ? 'searching' : 'working';
}

const KIND_ICONS: Readonly<Record<SearchKind, IconName>> = {
  app: 'app-window',
  file: 'file',
  command: 'zap',
  fact: 'lightbulb',
  history: 'history',
  note: 'sticky-note',
  document: 'file-text',
  reminder: 'bell',
  web: 'globe',
  ask: 'leaf',
  setting: 'settings',
};

export function kindIconName(kind: SearchKind): IconName {
  return KIND_ICONS[kind];
}
