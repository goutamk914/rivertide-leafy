/**
 * Deterministic fast-path intent router (pure, no network, well under 5 ms).
 * Turns common spoken commands into a tool call; anything it is unsure about returns null and
 * goes to the LLM agent. App names must match an installed app, so ordinary sentences like
 * "I'm going to open up about my feelings" never trigger actions.
 */
import { extractWhen, parseDurationMinutes, parseNumberWords } from './time-grammar';
import type { RivertidePage } from './tools/rivertide';

export type Intent =
  | { readonly kind: 'tool'; readonly tool: string; readonly input: Readonly<Record<string, unknown>> }
  /** "open the second one" — index is 0-based, -1 means the last item. */
  | { readonly kind: 'follow-up'; readonly action: 'open' | 'reveal'; readonly index: number };

export interface RouterContext {
  readonly now: Date;
  /** The installed app's proper name for a spoken name, or null when no app matches. */
  readonly resolveApp: (name: string) => string | null;
}

type Matcher = (text: string, context: RouterContext) => Intent | null;

const tool = (name: string, input: Record<string, unknown> = {}): Intent => ({ kind: 'tool', tool: name, input });

const PREFIXES = [
  /^(?:hey |hi |ok |okay )?(?:leafy|rivertide),?\s+/,
  /^(?:please|kindly|just|now|so|um|uh|ok|okay|alright|all right),?\s+/,
  /^(?:can|could|would|will) you(?: please)?\s+/,
  /^(?:i'd like you to|i would like you to|i want you to|i need you to|go ahead and)\s+/,
];
const SUFFIXES = [/,?\s+(?:please|for me|thanks|thank you|right now|now)$/];

/** Lowercases, strips politeness/wake words and end punctuation, and joins "youtube dot com". */
export function normalizeUtterance(raw: string): string {
  let text = raw.toLowerCase().replace(/[“”"]/g, '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
  text = text.replace(/[.!?…]+$/g, '').replace(/\b(\w+) dot (com|org|net|io|gov|edu|co|uk|ca|app|ai)\b/g, '$1.$2');
  for (let changed = true; changed;) {
    const before = text;
    PREFIXES.forEach((pattern) => { text = text.replace(pattern, ''); });
    SUFFIXES.forEach((pattern) => { text = text.replace(pattern, ''); });
    text = text.replace(/[,]+$/g, '').trim();
    changed = text !== before;
  }
  return text;
}

const ORDINALS: Readonly<Record<string, number>> = {
  first: 0, '1st': 0, top: 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, last: -1,
};

const followUp: Matcher = (text) => {
  const ordinal = /^(open|show|reveal|show me)\s+(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|top)(?:\s+(?:one|result|file|match|item))?(\s+in\s+(?:finder|its folder|the folder|explorer))?$/.exec(text);
  if (ordinal) return { kind: 'follow-up', action: ordinal[1] === 'reveal' || ordinal[3] ? 'reveal' : 'open', index: ORDINALS[ordinal[2]] };
  const numbered = /^(open|show)\s+(?:number|result|item|#)\s*(\d)$/.exec(text);
  return numbered && Number(numbered[2]) >= 1 ? { kind: 'follow-up', action: 'open', index: Number(numbered[2]) - 1 } : null;
};

const startDictation: Matcher = (text) =>
  /^(?:(?:start|begin)\s+(?:a\s+|taking\s+)?(?:dictation|dictating)|(?:take|start taking)\s+(?:a\s+)?dictation|dictate|dictation mode|(?:i want to|let me) dictate(?: something)?|(?:start|begin) (?:typing|writing) what i say)$/.test(text)
    ? tool('start_dictation') : null;

const timeOrDate: Matcher = (text) => {
  if (/^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?time(?:\s+(?:is it|now|right now))?$|^what time is it(?: now| right now)?$|^(?:do you know|tell me) what time it is$/.test(text)) {
    return tool('get_system_status', { fields: ['time'] });
  }
  if (/^what(?:'s| is)\s+(?:the\s+|today's\s+)?date(?:\s+today)?$|^what (?:day|date) is (?:it|today)(?: today)?$|^what day of the week is it$|^(?:tell me )?today's date$|^what's today$/.test(text)) {
    return tool('get_system_status', { fields: ['date'] });
  }
  return null;
};

const battery: Matcher = (text) =>
  /^(?:what(?:'s| is)\s+)?(?:my\s+|the\s+)?battery(?:\s+(?:level|life|percentage|percent|status))?(?:\s+at)?$|^how much battery(?:\s+(?:do i have|is left|have i got))?(?:\s+left)?$|^how(?:'s| is) (?:my |the )?battery(?: doing)?$|^check (?:my |the )?battery$/.test(text)
    ? tool('get_system_status', { fields: ['battery'] }) : null;

const MAX_TIMER_MINUTES = 1440;

function timerIntent(duration: string, label: string | undefined): Intent | null {
  const minutes = parseDurationMinutes(duration);
  if (minutes === null || minutes <= 0 || minutes > MAX_TIMER_MINUTES) return null;
  return tool('set_timer', label ? { minutes, label: label.trim() } : { minutes });
}

const timer: Matcher = (text) => {
  const forDuration = /^(?:set|start|make|create)\s+(?:a\s+|an\s+|the\s+)?timer\s+(?:for\s+)?(.+?)(?:\s+(?:called|named|labeled|for)\s+(.+))?$/.exec(text);
  if (forDuration) return timerIntent(forDuration[1], forDuration[2]) ?? timerIntent(`${forDuration[1]} ${forDuration[2] ?? ''}`, undefined);
  const durationFirst = /^(?:set|start|make|create)?\s*(?:a\s+|an\s+)?(.+?)\s+timer(?:\s+(?:called|named|labeled|for)\s+(.+))?$/.exec(text);
  if (durationFirst) return timerIntent(durationFirst[1].replace(/-/g, ' '), durationFirst[2]);
  const bare = /^timer\s+(?:for\s+)?(.+)$/.exec(text);
  return bare ? timerIntent(bare[1], undefined) : null;
};

const reminder: Matcher = (text, context) => {
  const spoken = /^remind me(?:\s+(?:to|about|that))?\s+(.+)$/.exec(text)
    ?? /^(?:set|add|create|make)\s+(?:a\s+)?reminder\s+(?:to\s+|for\s+|about\s+|that\s+)?(.+)$/.exec(text);
  if (!spoken) return null;
  const when = extractWhen(spoken[1], context.now);
  if (!when) return null;
  const subject = when.rest.replace(/^(?:to|about|that)\s+/, '').trim();
  return tool('create_reminder', { text: subject || 'Reminder', dueAt: when.at.toISOString() });
};

const VOLUME_WORDS: Readonly<Record<string, number>> = { max: 100, maximum: 100, full: 100, half: 50, 'half way': 50, halfway: 50, zero: 0 };

const volume: Matcher = (text) => {
  const audio = '(?:the\\s+|my\\s+)?(?:sound|volume|audio|computer|mac|speakers?|everything)';
  if (new RegExp(`^(?:mute|silence)(?:\\s+${audio})?$`).test(text) || /^(?:turn|switch)\s+(?:the\s+)?(?:sound|volume|audio)\s+off$|^(?:turn|switch)\s+off\s+the\s+(?:sound|audio)$/.test(text)) {
    return tool('set_volume', { mute: true });
  }
  if (new RegExp(`^unmute(?:\\s+${audio})?$`).test(text) || /^(?:turn|switch)\s+(?:the\s+)?(?:sound|audio)\s+(?:back\s+)?on$/.test(text)) {
    return tool('set_volume', { mute: false });
  }
  const step = /^(?:turn|crank|bump|pump|put)\s+(?:the\s+)?(?:volume|sound|music|it)\s+(up|down)(?:\s+a\s+(?:bit|little|notch))?$|^(?:turn|crank|bump)\s+(up|down)\s+the\s+(?:volume|sound|music)$|^volume\s+(up|down)$/.exec(text);
  if (step) return tool('set_volume', { change: step[1] ?? step[2] ?? step[3] });
  const relative = /^(?:make it\s+)?(louder|quieter|softer)$|^(raise|increase|lower|decrease|reduce)\s+(?:the\s+)?(?:volume|sound)$/.exec(text);
  if (relative) return tool('set_volume', { change: /louder|raise|increase/.test(relative[0]) ? 'up' : 'down' });
  const exact = /^(?:(?:set|change|put|turn|make)\s+(?:the\s+)?(?:volume|sound)\s+(?:to|at|up to|down to)|volume\s+(?:to|at)?)\s*(.+?)(?:\s*(?:%|percent))?$/.exec(text);
  if (!exact) return null;
  const level = VOLUME_WORDS[exact[1].trim()] ?? parseNumberWords(exact[1]);
  return level !== null && level >= 0 && level <= 100 ? tool('set_volume', { level: Math.round(level) }) : null;
};

const media: Matcher = (text) => {
  const object = '(?:\\s+(?:the\\s+|some\\s+)?(?:music|song|track|podcast|playback|audio|video|it))';
  if (new RegExp(`^(?:play|resume|unpause|continue)${object}?$`).test(text) && text !== 'continue') return tool('media_control', { action: 'play' });
  if (new RegExp(`^(?:pause${object}?|stop${object})$`).test(text)) return tool('media_control', { action: 'pause' });
  if (/^(?:next|skip)(?:\s+(?:this\s+|the\s+)?(?:song|track|one))?$|^(?:play\s+(?:the\s+)?next|go to the next)\s+(?:song|track)$|^skip (?:ahead|forward)$/.test(text)) {
    return tool('media_control', { action: 'next' });
  }
  if (/^previous(?:\s+(?:song|track))?$|^(?:play\s+(?:the\s+)?(?:previous|last)|go back(?:\s+(?:to\s+the\s+|a\s+)?(?:previous|last))?|(?:go\s+)?back\s+(?:a|one))\s+(?:song|track)$/.test(text)) {
    return tool('media_control', { action: 'previous' });
  }
  return null;
};

const darkMode: Matcher = (text) => {
  const mode = '(dark|light)\\s*mode';
  const onOff = new RegExp(`^(?:turn|switch|put)\\s+(on|off)\\s+${mode}$|^(?:turn|switch|put)\\s+${mode}\\s+(on|off)$|^${mode}\\s+(on|off)$`).exec(text);
  if (onOff) {
    const which = onOff[2] ?? onOff[3] ?? onOff[5];
    const state = onOff[1] ?? onOff[4] ?? onOff[6];
    return tool('set_dark_mode', { on: (which === 'dark') === (state === 'on') });
  }
  const toggle = new RegExp(`^(enable|disable|activate|deactivate)\\s+${mode}$`).exec(text);
  if (toggle) return tool('set_dark_mode', { on: (toggle[2] === 'dark') === /^(?:enable|activate)$/.test(toggle[1]) });
  const switchTo = new RegExp(`^(?:switch|go|change|turn it|change it|switch it)\\s+(?:to|into)\\s+${mode}$|^(?:use\\s+)?${mode}$`).exec(text);
  return switchTo ? tool('set_dark_mode', { on: (switchTo[1] ?? switchTo[2]) === 'dark' }) : null;
};

const screenAndLock: Matcher = (text) => {
  if (/^lock\s+(?:the\s+|my\s+)?(?:screen|computer|mac|laptop|desktop|pc)(?:\s+now)?$/.test(text)) return tool('lock_screen');
  if (/^(?:turn off|switch off|sleep|put to sleep)\s+(?:the\s+|my\s+)?(?:display|screen|monitor)s?$|^put\s+(?:the\s+)?(?:display|screen|monitor)\s+to\s+sleep$/.test(text)) {
    return tool('sleep_display');
  }
  if (/^(?:take|grab|capture|make|snap)\s+(?:a\s+)?(?:screenshot|screen\s*shot|screen capture|screen grab|picture of (?:the|my) screen)(?:\s+(?:of\s+)?(?:the\s+|my\s+)?(?:screen|desktop|whole screen))?$|^screenshot(?: (?:the|my) screen)?$/.test(text)) {
    return tool('take_screenshot');
  }
  return null;
};

const files: Matcher = (text) => {
  const patterns = [
    /^(?:find|search|look|look for|locate|search for|look up)\s+(?:for\s+)?(?:in\s+|through\s+)?(?:my|the)\s+(?:files|computer|mac|documents|docs|folders|downloads|desktop)\s+(?:for|about|called|named|with|that (?:mention|contain|have))\s+(.+)$/,
    /^(?:find|search for|look for|locate)\s+(?:my\s+|the\s+|a\s+)?(?:files?|documents?|docs?|pdfs?|spreadsheets?|folders?|photos?|pictures?)\s+(?:called|named|about|for|with|on|from)\s+(.+)$/,
    /^(?:find|locate)\s+(?:my\s+|the\s+)(.+?)\s+(?:file|document|pdf|spreadsheet|folder|presentation|doc)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1].trim()) return tool('search_files', { query: match[1].trim() });
  }
  return null;
};

const web: Matcher = (text) => {
  const match = /^(?:search|look)\s+(?:the\s+)?(?:web|internet|online|google)\s+(?:for\s+)?(.+)$/.exec(text)
    ?? /^(?:search|look up|look)\s+(?:for\s+)?(.+?)\s+(?:(?:on|in)\s+(?:the\s+)?(?:web|internet|google)|online)$/.exec(text)
    ?? /^(?:google|bing)\s+(?!is\b|was\b|are\b|has\b)(.+)$/.exec(text)
    ?? /^(?:look up|search for|search)\s+(?!my\b|our\b)(.+)$/.exec(text);
  return match && match[1].trim() ? tool('web_search', { query: match[1].trim() }) : null;
};

const note: Matcher = (text) => {
  const match = /^(?:new note|take a note|make a note|add a note|create a note|start a note|jot (?:this |that )?down|write (?:this |that )?down|note to self)\s*[:,-]?\s*(?:that\s+|saying\s+|to say\s+)?(.+)$/.exec(text);
  return match && match[1].trim() ? tool('create_note', { body: match[1].trim() }) : null;
};

const PAGES: Readonly<Record<string, RivertidePage>> = {
  history: 'history', chat: 'chat', knowledge: 'knowledge', 'knowledge base': 'knowledge', insights: 'insights',
  dashboard: 'home', home: 'home', 'home page': 'home', documents: 'documents', notes: 'notes', reminders: 'notes',
  settings: 'settings', preferences: 'settings',
};
/** Pages whose names clash with apps or folders need "rivertide"/"your"/"page" to be routed here. */
const ALWAYS_OURS: ReadonlySet<string> = new Set(['history', 'chat', 'knowledge', 'knowledge base', 'insights', 'dashboard']);

const rivertidePage: Matcher = (text) => {
  if (/^(?:open|show|show me)\s+(?:rivertide|leafy)$/.test(text)) return tool('open_rivertide', { page: 'home' });
  const match = /^(?:open|show|go to|show me|take me to|bring up)\s+(?:(my|the|your)\s+)?(rivertide\s+|leafy\s+|leafy's\s+)?(history|chat|knowledge base|knowledge|documents|notes|reminders|insights|settings|dashboard|home page|home|preferences)(\s+(?:page|tab|screen|section|window))?(\s+in\s+rivertide)?$/.exec(text);
  if (!match) return null;
  const qualified = match[1] === 'your' || Boolean(match[2] || match[4] || match[5]);
  return ALWAYS_OURS.has(match[3]) || qualified ? tool('open_rivertide', { page: PAGES[match[3]] }) : null;
};

const quitApp: Matcher = (text, context) => {
  const match = /^(?:quit|close|exit|kill|force quit|shut down|shut)\s+(?:out\s+of\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+app(?:lication)?)?$/.exec(text);
  const name = match ? context.resolveApp(match[1]) : null;
  return name ? tool('quit_app', { name }) : null;
};

const openThing: Matcher = (text, context) => {
  const url = /^(?:open|go to|visit|load|pull up)\s+(?:the\s+)?(?:website\s+|site\s+|page\s+)?((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)$/.exec(text);
  if (url) return tool('open_url', { url: /^https?:\/\//.test(url[1]) ? url[1] : `https://${url[1]}` });
  const app = /^(?:open|launch|start|run|bring up|pull up|switch to|go to|show)\s+(?:up\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+app(?:lication)?)?$/.exec(text);
  const name = app ? context.resolveApp(app[1]) : null;
  return name ? tool('open_app', { name }) : null;
};

const MATCHERS: readonly Matcher[] = [
  followUp, startDictation, timeOrDate, battery, timer, reminder, volume, media, darkMode, screenAndLock,
  files, web, note, rivertidePage, quitApp, openThing,
];

/** Parses one utterance into an intent, or null when the LLM should handle it. */
export function parseIntent(raw: string, context: RouterContext): Intent | null {
  const text = normalizeUtterance(raw);
  if (!text || text.length > 300) return null;
  for (const matcher of MATCHERS) {
    const intent = matcher(text, context);
    if (intent) return intent;
  }
  return null;
}
