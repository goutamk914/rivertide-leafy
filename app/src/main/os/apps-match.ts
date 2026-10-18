/**
 * Fuzzy app matching (pure). Handles how people say app names out loud — "the calendar app",
 * "spot if i", "browser", "music" — via normalisation, aliases and a small edit distance.
 */
import type { AppEntry } from '../services';

export interface IndexedApp {
  readonly entry: AppEntry;
  /** Normalised names to match against (folder name, display name, bundle name). */
  readonly keys: readonly string[];
}

/** Spoken name → app names to try in order (the first one installed wins). */
export const APP_ALIASES: Readonly<Record<string, readonly string[]>> = {
  calendar: ['Calendar', 'Fantastical', 'Microsoft Outlook'],
  music: ['Music', 'Spotify'],
  'apple music': ['Music'],
  mail: ['Mail', 'Microsoft Outlook', 'Spark'],
  email: ['Mail', 'Microsoft Outlook', 'Spark'],
  'e mail': ['Mail', 'Microsoft Outlook'],
  messages: ['Messages'],
  texts: ['Messages'],
  imessage: ['Messages'],
  settings: ['System Settings', 'System Preferences', 'Settings'],
  'system preferences': ['System Settings', 'System Preferences'],
  preferences: ['System Settings', 'System Preferences'],
  terminal: ['Terminal', 'iTerm'],
  word: ['Microsoft Word'],
  excel: ['Microsoft Excel'],
  powerpoint: ['Microsoft PowerPoint'],
  outlook: ['Microsoft Outlook'],
  teams: ['Microsoft Teams'],
  chrome: ['Google Chrome'],
  edge: ['Microsoft Edge'],
  zoom: ['zoom.us', 'Zoom'],
  'vs code': ['Visual Studio Code'],
  vscode: ['Visual Studio Code'],
  facetime: ['FaceTime'],
  'text edit': ['TextEdit'],
  notes: ['Notes'],
  photos: ['Photos'],
  files: ['Finder', 'File Explorer', 'Files'],
  'file explorer': ['File Explorer', 'Finder'],
  calculator: ['Calculator'],
  camera: ['Photo Booth', 'Camera'],
  'app store': ['App Store'],
};

/** Words for "whatever my default browser is". */
export const BROWSER_WORDS: ReadonlySet<string> = new Set(['browser', 'web browser', 'internet', 'the internet', 'web']);

export function normaliseAppName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.(app|lnk|desktop|exe)$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strips spoken filler around an app name: "the calendar app" → "calendar". */
export function cleanSpokenAppName(query: string): string {
  return normaliseAppName(query)
    .replace(/^(?:the|my|a|an)\s+/, '')
    .replace(/\s+(?:app|application|program)$/, '')
    .trim();
}

const compact = (value: string): string => value.replace(/\s+/g, '');

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

const isSubsequence = (needle: string, haystack: string): boolean => {
  let index = 0;
  for (const char of haystack) if (char === needle[index]) index += 1;
  return index === needle.length;
};

/** 0..100 match score of a cleaned query against one normalised key. */
export function scoreKey(query: string, key: string): number {
  if (!query || !key) return 0;
  if (key === query) return 100;
  if (compact(key) === compact(query)) return 98;
  if (key.startsWith(query)) return 85 - Math.min(15, (key.length - query.length) * 0.5);
  if (key.split(' ').some((word) => word.startsWith(query))) return 75;
  const initials = key.split(' ').map((word) => word[0]).join('');
  if (query.length >= 2 && initials === compact(query)) return 72;
  if (key.includes(query)) return 65;
  const distance = editDistance(compact(query), compact(key));
  if (compact(query).length >= 5 && distance <= 2) return 68 - distance * 4;
  if (query.length >= 3 && isSubsequence(compact(query), compact(key))) return 40 * (compact(query).length / compact(key).length);
  return 0;
}

export const scoreApp = (query: string, app: IndexedApp): number => Math.max(0, ...app.keys.map((key) => scoreKey(query, key)));

export const FIND_THRESHOLD = 60;

export interface MatchContext {
  readonly apps: readonly IndexedApp[];
  /** Name of the default web browser (e.g. "Safari"), if known. */
  readonly defaultBrowser: string | null;
}

function findExact(apps: readonly IndexedApp[], name: string): AppEntry | null {
  const target = normaliseAppName(name);
  return apps.find((app) => app.keys.includes(target))?.entry ?? null;
}

/** Best single app for a spoken name, or null when nothing is a confident match. */
export function findApp(query: string, context: MatchContext): AppEntry | null {
  const cleaned = cleanSpokenAppName(query);
  if (!cleaned) return null;
  if (BROWSER_WORDS.has(cleaned)) {
    const browser = context.defaultBrowser ? findExact(context.apps, context.defaultBrowser) : null;
    return browser ?? findExact(context.apps, 'Safari') ?? findExact(context.apps, 'Google Chrome') ?? findExact(context.apps, 'Microsoft Edge');
  }
  const direct = findExact(context.apps, cleaned);
  if (direct) return direct;
  for (const alias of APP_ALIASES[cleaned] ?? []) {
    const hit = findExact(context.apps, alias);
    if (hit) return hit;
  }
  const [top] = rank(cleaned, context.apps);
  return top && top.score >= FIND_THRESHOLD ? top.app.entry : null;
}

const MIN_SEARCH_SCORE = 30;

function rank(cleaned: string, apps: readonly IndexedApp[]): { app: IndexedApp; score: number }[] {
  return apps
    .map((app) => ({ app, score: scoreApp(cleaned, app) }))
    .filter((item) => item.score >= MIN_SEARCH_SCORE)
    .sort((a, b) => b.score - a.score || a.app.entry.name.localeCompare(b.app.entry.name));
}

/** Ranked apps for the palette and "open the second one" follow-ups. */
export function searchApps(query: string, apps: readonly IndexedApp[], limit: number): AppEntry[] {
  const cleaned = cleanSpokenAppName(query);
  if (!cleaned) return [];
  return rank(cleaned, apps).slice(0, limit).map((item) => item.app.entry);
}

export function indexApp(entry: AppEntry, extraNames: readonly string[] = []): IndexedApp {
  const keys = [...new Set([entry.name, ...extraNames].map(normaliseAppName).filter(Boolean))];
  return { entry, keys };
}
