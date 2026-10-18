/**
 * Plain-language formatters shared by the dashboard and overlay windows.
 * Pure functions: every one takes its clock (`now`) and locale as arguments so tests are stable.
 */

const MS_SECOND = 1000;
const MS_MINUTE = 60 * MS_SECOND;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const DEFAULT_LOCALE = 'en-US';

const toDate = (value: Date | string | number): Date => (value instanceof Date ? value : new Date(value));

/** "1 word" / "3 words". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${Math.abs(count) === 1 ? singular : plural}`;
}

/** "1,284". */
export function formatCount(value: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value));
}

/** "12.9K", "4.2M"; small numbers stay exact. */
export function formatCompact(value: number, locale = DEFAULT_LOCALE): string {
  if (Math.abs(value) < 10_000) return formatCount(value, locale);
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Local calendar day key, e.g. "2026-10-15". */
export function dayKey(value: Date | string | number): string {
  const d = toDate(value);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Parses a "YYYY-MM-DD" key as local midnight. */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** "2:03 PM". */
export function formatClock(value: Date | string, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(toDate(value));
}

/** "Oct 12". */
export function formatShortDate(value: Date | string, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(toDate(value));
}

/** "Oct 12, 2:03 PM" (year added when it is not this year). */
export function formatDateTime(value: Date | string, now: Date = new Date(), locale = DEFAULT_LOCALE): string {
  const d = toDate(value);
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** "Today", "Yesterday", "Tomorrow", or "Monday, October 12". */
export function formatDayHeading(value: Date | string, now: Date = new Date(), locale = DEFAULT_LOCALE): string {
  const d = toDate(value);
  const diffDays = Math.round((dateFromKey(dayKey(d)).getTime() - dateFromKey(dayKey(now)).getTime()) / MS_DAY);
  if (diffDays === 0) return 'Today';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'Tomorrow';
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/** "in 5 minutes", "2 hours ago", "just now". */
export function formatRelative(value: Date | string, now: Date = new Date(), locale = DEFAULT_LOCALE): string {
  const diff = toDate(value).getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < 45 * MS_SECOND) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < MS_HOUR) return rtf.format(Math.round(diff / MS_MINUTE), 'minute');
  if (abs < MS_DAY) return rtf.format(Math.round(diff / MS_HOUR), 'hour');
  return rtf.format(Math.round(diff / MS_DAY), 'day');
}

/** "45 s", "2 min 5 s", "1 h 3 min". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < MS_SECOND) return `${Math.round(ms)} ms`;
  if (ms < MS_MINUTE) {
    const seconds = ms / MS_SECOND;
    return `${seconds < 10 ? seconds.toFixed(1).replace(/\.0$/, '') : Math.round(seconds)} s`;
  }
  if (ms < MS_HOUR) {
    const minutes = Math.floor(ms / MS_MINUTE);
    const seconds = Math.round((ms % MS_MINUTE) / MS_SECOND);
    return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  const hours = Math.floor(ms / MS_HOUR);
  const minutes = Math.round((ms % MS_HOUR) / MS_MINUTE);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** Text length as a friendly size: "820 characters", "12K characters". */
export function formatChars(chars: number, locale = DEFAULT_LOCALE): string {
  return `${formatCompact(chars, locale)} ${chars === 1 ? 'character' : 'characters'}`;
}

/** Greeting by local hour. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First non-empty line, trimmed to `max` characters with an ellipsis. */
export function firstLine(text: string, max = 120): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export interface DayGroup<T> {
  readonly key: string;
  readonly label: string;
  readonly items: readonly T[];
}

/** Groups items (already sorted) into consecutive local-day buckets with readable labels. */
export function groupByDay<T>(items: readonly T[], getDate: (item: T) => string, now: Date = new Date()): DayGroup<T>[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dayKey(getDate(item));
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: formatDayHeading(getDate(item), now), items: [item] });
    }
  }
  return groups;
}

const MAC_KEYS: Readonly<Record<string, string>> = {
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  command: '⌘',
  cmd: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  super: '⌘',
  meta: '⌘',
};

const OTHER_KEYS: Readonly<Record<string, string>> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  command: 'Ctrl',
  cmd: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Win',
  meta: 'Win',
};

/** "CommandOrControl+Shift+Space" → ["⌘", "⇧", "Space"] on macOS, ["Ctrl", "Shift", "Space"] elsewhere. */
export function acceleratorToKeys(accelerator: string, platform: 'darwin' | 'win32' | 'linux' = 'darwin'): string[] {
  const map = platform === 'darwin' ? MAC_KEYS : OTHER_KEYS;
  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => map[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part));
}

/** Spoken-friendly version for screen readers: "Command Shift Space". */
export function acceleratorToSpeech(accelerator: string, platform: 'darwin' | 'win32' | 'linux' = 'darwin'): string {
  const names: Readonly<Record<string, string>> = { '⌘': 'Command', '⌃': 'Control', '⌥': 'Option', '⇧': 'Shift' };
  return acceleratorToKeys(accelerator, platform).map((k) => names[k] ?? k).join(' ');
}
