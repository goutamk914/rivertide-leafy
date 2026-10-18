/**
 * Palette result providers. Each returns candidates (result + the action to run) with a base
 * score; index.ts runs them in parallel under per-provider time budgets, merges and ranks them.
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { SearchKind, SearchResult } from '../../shared/types';
import type { AppContext, AppEntry, SearchHit } from '../services';
import { truncate } from '../data/store';
import { PALETTE_COMMANDS, ROUTES } from './commands';
import { ASK_DEFAULT_QUALITY, ASK_FIRST_SCORE, looksLikeRequest, matchQuality, PROVIDER_WEIGHT, WEB_QUALITY } from './scoring';

export type PaletteAction =
  | { readonly type: 'app'; readonly entry: AppEntry }
  | { readonly type: 'file'; readonly path: string }
  | { readonly type: 'route'; readonly route: string }
  | { readonly type: 'command'; readonly commandId: string }
  | { readonly type: 'ask'; readonly text: string }
  | { readonly type: 'web'; readonly query: string };

export interface Candidate {
  readonly result: Omit<SearchResult, 'score'>;
  readonly action: PaletteAction;
  readonly score: number;
}

export const APP_LIMIT = 6;
export const FILE_LIMIT = 6;
export const MEMORY_LIMIT = 12;
export const UPCOMING_REMINDERS = 3;
export const MIN_FILE_QUERY = 2;
const MATCHED_FLOOR = 0.3;
const SUBTITLE_CHARS = 120;
const KEYWORD_FACTOR = 0.9;

export const shortHash = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 16);

const candidate = (kind: SearchKind, id: string, title: string, subtitle: string | null, icon: string | null, action: PaletteAction, quality: number): Candidate => ({
  result: { id, kind, title, subtitle, icon }, action, score: PROVIDER_WEIGHT[kind] * quality,
});

export function commandCandidates(ctx: AppContext, query: string): Candidate[] {
  return PALETTE_COMMANDS
    .filter((command) => command.available?.(ctx) ?? true)
    .map((command) => {
      const keywordQuality = Math.max(0, ...command.keywords.map((keyword) => matchQuality(query, keyword))) * KEYWORD_FACTOR;
      const quality = query.trim() ? Math.max(matchQuality(query, command.title), keywordQuality) : 0.5;
      const action: PaletteAction = command.route ? { type: 'route', route: command.route } : { type: 'command', commandId: command.id };
      return candidate('command', command.id, command.title, command.subtitle, command.icon, action, quality);
    })
    .filter((entry) => entry.score > 0);
}

export async function appCandidates(ctx: AppContext, query: string, iconBudgetMs: number): Promise<Candidate[]> {
  if (!query.trim()) return [];
  const apps = ctx.os.apps.search(query, APP_LIMIT);
  const icons = await Promise.all(apps.map((app) => withTimeout(ctx.os.apps.iconDataUrl(app.path), iconBudgetMs, null).catch(() => null)));
  return apps.map((app, index) => candidate(
    'app', `app:${shortHash(app.path)}`, app.name, 'Application', icons[index] ?? 'icon:app-window',
    { type: 'app', entry: app }, Math.max(matchQuality(query, app.name), MATCHED_FLOOR),
  ));
}

const displayPath = (path: string): string => {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

export async function fileCandidates(ctx: AppContext, query: string): Promise<Candidate[]> {
  if (query.trim().length < MIN_FILE_QUERY) return [];
  const hits = await ctx.os.files.search(query, { limit: FILE_LIMIT });
  return hits
    .filter((hit) => !hit.path.endsWith('.app'))
    .map((hit) => candidate(
      'file', `file:${shortHash(hit.path)}`, hit.name, displayPath(hit.path), hit.kind === 'folder' ? 'icon:folder' : 'icon:file',
      { type: 'file', path: hit.path }, Math.max(matchQuality(query, hit.name), MATCHED_FLOOR),
    ));
}

const MEMORY_ROUTE: Readonly<Record<SearchHit['kind'], string>> = {
  fact: ROUTES.knowledge, note: ROUTES.notes, document: ROUTES.documents, history: ROUTES.history,
};
const MEMORY_ICON: Readonly<Record<SearchHit['kind'], string>> = {
  fact: 'icon:lightbulb', note: 'icon:sticky-note', document: 'icon:file-text', history: 'icon:history',
};

export function memoryCandidates(ctx: AppContext, query: string): Candidate[] {
  const hits = ctx.search.search(query, { kinds: ['fact', 'note', 'document', 'history'], limit: MEMORY_LIMIT });
  const best = Math.max(0, ...hits.map((hit) => hit.score));
  return hits.map((hit) => {
    const relative = best > 0 ? hit.score / best : 0;
    const quality = 0.35 + 0.45 * relative + 0.2 * matchQuality(query, hit.title);
    return candidate(hit.kind, `${hit.kind}:${hit.id}`, hit.title, truncate(hit.snippet, SUBTITLE_CHARS), MEMORY_ICON[hit.kind],
      { type: 'route', route: `${MEMORY_ROUTE[hit.kind]}/${hit.id}` }, quality);
  });
}

export function formatDue(dueAt: string, now: number): string {
  const due = new Date(dueAt);
  const today = new Date(now);
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round((new Date(due).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);
  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Tomorrow at ${time}`;
  return `${due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

export function reminderCandidates(ctx: AppContext, query: string, now: number): Candidate[] {
  const scheduled = ctx.reminders.list().filter((reminder) => reminder.status === 'scheduled');
  const matching = query.trim()
    ? scheduled.map((reminder) => ({ reminder, quality: matchQuality(query, reminder.text) })).filter((entry) => entry.quality > 0)
    : scheduled.slice(0, UPCOMING_REMINDERS).map((reminder) => ({ reminder, quality: 0.45 }));
  return matching.map(({ reminder, quality }) => candidate(
    'reminder', `reminder:${reminder.id}`, reminder.text, formatDue(reminder.dueAt, now),
    reminder.kind === 'timer' ? 'icon:timer' : 'icon:bell', { type: 'route', route: ROUTES.reminders }, quality,
  ));
}

export function askAndWebCandidates(query: string): Candidate[] {
  const text = query.trim();
  if (!text) return [];
  const key = shortHash(text.toLowerCase());
  const ask = candidate('ask', `ask:${key}`, `Ask Leafy: ${text}`, 'Leafy answers or does it for you', 'icon:sparkles',
    { type: 'ask', text }, ASK_DEFAULT_QUALITY);
  const web = candidate('web', `web:${key}`, `Search the web for “${text}”`, 'Opens your browser', 'icon:globe',
    { type: 'web', query: text }, WEB_QUALITY);
  return [looksLikeRequest(text) ? { ...ask, score: ASK_FIRST_SCORE } : ask, web];
}

/** A non-ask result at or above this score matches the query almost exactly ("open settings"). */
export const STRONG_MATCH_SCORE = 0.85;

/** "Ask Leafy" leads for requests unless another result already matches the query almost exactly. */
export function settleAsk(candidates: readonly Candidate[]): Candidate[] {
  const strong = candidates.some((c) => c.result.kind !== 'ask' && c.result.kind !== 'web' && c.score >= STRONG_MATCH_SCORE);
  if (!strong) return [...candidates];
  return candidates.map((c) => (c.result.kind === 'ask' && c.score >= ASK_FIRST_SCORE
    ? { ...c, score: PROVIDER_WEIGHT.ask * ASK_DEFAULT_QUALITY }
    : c));
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
