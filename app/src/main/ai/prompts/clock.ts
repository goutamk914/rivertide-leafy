/** Local date/time descriptions for prompts and spoken replies (pure; `now` is injected). */

const pad = (value: number): string => String(Math.trunc(Math.abs(value))).padStart(2, '0');

/** "+02:00" style offset for the machine's local time zone at `now`. */
export function utcOffset(now: Date): string {
  const minutes = -now.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  return `${sign}${pad(minutes / 60)}:${pad(minutes % 60)}`;
}

/** Local ISO-8601 with offset, e.g. "2026-10-15T14:03:00-07:00". */
export function localIso(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${date}T${time}${utcOffset(now)}`;
}

export const timeZoneName = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';

/** "Thursday, 15 October 2026, 2:03 PM" in the system locale. */
export function humanDateTime(now: Date, locale?: string): string {
  const date = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${date}, ${humanTime(now, locale)}`;
}

export const humanTime = (now: Date, locale?: string): string =>
  now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

export const humanDate = (now: Date, locale?: string): string =>
  now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
