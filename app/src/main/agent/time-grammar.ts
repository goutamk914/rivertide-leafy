/**
 * Small, deterministic time grammar for spoken reminders and timers (pure; `now` is injected).
 *
 * Durations: "10 minutes", "an hour and a half", "1 hour 30 minutes", "half an hour", "90 seconds".
 * Moments:   "in 20 minutes", "at 8", "at 8:30 pm", "tomorrow at 9", "tonight", "on friday at 3",
 *            "this afternoon", "at noon". Ambiguous hours pick the sensible next occurrence.
 */

const UNITS: Readonly<Record<string, number>> = {
  hour: 60, hours: 60, hr: 60, hrs: 60,
  minute: 1, minutes: 1, min: 1, mins: 1,
  second: 1 / 60, seconds: 1 / 60, sec: 1 / 60, secs: 1 / 60,
};
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_PART_HOUR: Readonly<Record<string, number>> = { morning: 9, afternoon: 15, evening: 18, tonight: 20, night: 20 };

/** "25", "2.5", "twenty five", "twenty-five", "a", "an", "a couple of" → number. */
export function parseNumberWords(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text === 'a' || text === 'an') return 1;
  if (/^(?:a )?couple(?: of)?$/.test(text)) return 2;
  if (/^(?:a )?few$/.test(text)) return 3;
  const words = text.split(' ');
  if (words.length === 1) {
    const one = ONES.indexOf(words[0]);
    if (one >= 0) return one;
    return TENS[words[0]] ?? (words[0] === 'hundred' ? 100 : null);
  }
  if (words.length === 2 && TENS[words[0]] !== undefined) {
    const unit = ONES.indexOf(words[1]);
    return unit > 0 && unit < 10 ? TENS[words[0]] + unit : null;
  }
  if (words.length === 2 && words[1] === 'hundred') {
    const unit = ONES.indexOf(words[0]);
    return unit > 0 ? unit * 100 : null;
  }
  return null;
}

const NUMBER = String.raw`\d+(?:\.\d+)?|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|${ONES.slice(1).join('|')}|an?|(?:a )?couple(?: of)?|(?:a )?few`;
const DURATION_PART = new RegExp(String.raw`(${NUMBER})\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b(\s+and\s+a\s+half)?`, 'g');

/** Total minutes of a spoken duration, or null when the text is not purely a duration. */
export function parseDurationMinutes(raw: string): number | null {
  let text = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  let total = 0;
  const special: readonly [RegExp, number][] = [[/\bhalf (?:an )?hour\b/, 30], [/\b(?:a )?quarter (?:of an )?hour\b/, 15], [/\bhalf (?:a )?minute\b/, 0.5]];
  for (const [pattern, minutes] of special) {
    if (pattern.test(text)) {
      total += minutes;
      text = text.replace(pattern, ' ');
    }
  }
  const leftover = text.replace(DURATION_PART, (_match, count: string, unit: string, half: string | undefined) => {
    const amount = parseNumberWords(count) ?? 0;
    const perUnit = UNITS[unit] ?? 0;
    total += (amount + (half ? 0.5 : 0)) * perUnit;
    return ' ';
  });
  if (leftover.replace(/\b(?:and|for|a|plus)\b|[,\s]/g, '') !== '') return null;
  return total > 0 ? Math.round(total * 1000) / 1000 : null;
}

interface Clock { readonly hour: number; readonly minute: number; readonly meridiem: 'am' | 'pm' | null }

/** "8", "8:30", "8 30 pm", "8:30pm", "8 o'clock", "noon", "midnight", "half past 8", "20:15". */
export function parseClock(raw: string): Clock | null {
  const text = raw.trim().toLowerCase().replace(/\./g, '').replace(/o['’ ]?\s?clock/g, 'oclock').replace(/\s+/g, ' ');
  if (text === 'noon' || text === 'midday') return { hour: 12, minute: 0, meridiem: 'pm' };
  if (text === 'midnight') return { hour: 0, minute: 0, meridiem: 'am' };
  const halfPast = /^half past (\w+)$/.exec(text);
  if (halfPast) {
    const hour = parseNumberWords(halfPast[1]);
    return hour !== null && hour >= 1 && hour <= 12 ? { hour, minute: 30, meridiem: null } : null;
  }
  const match = /^(\d{1,2})(?:(?::|\s)(\d{2}))?(?:\s*oclock)?\s*(am|pm|a m|p m)?$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3] ? (match[3].startsWith('a') ? 'am' : 'pm') : null;
  if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) return null;
  return { hour, minute, meridiem };
}

function to24(clock: Clock, hint: 'am' | 'pm' | 'day' | null): number {
  const meridiem = clock.meridiem ?? (clock.hour > 12 || clock.hour === 0 ? null : hint === 'day' ? (clock.hour === 12 || clock.hour <= 6 ? 'pm' : 'am') : hint);
  if (meridiem === 'am') return clock.hour % 12;
  if (meridiem === 'pm') return (clock.hour % 12) + 12;
  return clock.hour;
}

const atTime = (base: Date, dayOffset: number, hour: number, minute: number): Date =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, minute, 0, 0);

/** Next occurrence of an unqualified clock time ("at 8" → 8 AM or 8 PM, whichever comes first). */
function nextOccurrence(clock: Clock, now: Date): Date {
  const hours = clock.meridiem || clock.hour > 12 || clock.hour === 0 ? [to24(clock, null)] : [clock.hour % 12, (clock.hour % 12) + 12];
  const candidates = [0, 1].flatMap((day) => hours.map((hour) => atTime(now, day, hour, clock.minute)));
  return candidates.filter((date) => date.getTime() > now.getTime()).sort((a, b) => a.getTime() - b.getTime())[0];
}

interface DaySpec {
  readonly offset: number;
  readonly part: string | null;
  /** A day was actually said ("tomorrow", "friday", "tonight"…). */
  readonly explicit: boolean;
  /** Said as a weekday name: a time already past today means next week. */
  readonly weekday: boolean;
}

const IMPLICIT_DAY: DaySpec = { offset: 0, part: null, explicit: false, weekday: false };

/** "tomorrow", "tonight", "this afternoon", "on friday morning", "tomorrow night" → day spec. */
function parseDay(raw: string, now: Date): DaySpec | null {
  const text = raw.trim().replace(/^on /, '');
  if (text === '') return IMPLICIT_DAY;
  if (text === 'today') return { offset: 0, part: null, explicit: true, weekday: false };
  if (text === 'tonight') return { offset: 0, part: 'tonight', explicit: true, weekday: false };
  const thisPart = /^this (morning|afternoon|evening)$/.exec(text);
  if (thisPart) return { offset: 0, part: thisPart[1], explicit: true, weekday: false };
  const tomorrow = /^tomorrow(?: (morning|afternoon|evening|night))?$/.exec(text);
  if (tomorrow) return { offset: 1, part: tomorrow[1] ?? null, explicit: true, weekday: false };
  const weekday = new RegExp(`^(${WEEKDAYS.join('|')})(?: (morning|afternoon|evening|night))?$`).exec(text);
  if (!weekday) return null;
  const offset = (WEEKDAYS.indexOf(weekday[1]) - now.getDay() + 7) % 7;
  return { offset, part: weekday[2] ?? null, explicit: true, weekday: true };
}

function resolve(day: DaySpec, clock: Clock | null, now: Date): Date | null {
  if (!day.explicit) return clock ? nextOccurrence(clock, now) : null;
  const hint = day.part === 'morning' ? 'am' : day.part ? 'pm' : 'day';
  const hour = clock ? to24(clock, hint) : DAY_PART_HOUR[day.part ?? 'morning'];
  const minute = clock?.minute ?? 0;
  const date = atTime(now, day.offset, hour, minute);
  if (date.getTime() > now.getTime()) return date;
  // Past: a weekday that is today means next week; "today"/"tonight"/"this …" in the past is invalid.
  return day.weekday ? atTime(now, day.offset + 7, hour, minute) : null;
}

/** "8 tomorrow" / "8:30 pm tonight" → clock + day. */
function clockWithTrailingDay(raw: string, now: Date): { clock: Clock; day: DaySpec } | null {
  const match = /^(.+?) (today|tonight|tomorrow(?: morning| afternoon| evening| night)?|this (?:morning|afternoon|evening)|on \w+|\w+day)$/.exec(raw);
  if (!match) return null;
  const clock = parseClock(match[1]);
  const day = parseDay(match[2], now);
  return clock && day ? { clock, day } : null;
}

/** Parses a complete moment phrase ("in 20 minutes", "tomorrow at 9", "at 8:30 pm tonight"). */
export function parseMoment(raw: string, now: Date): Date | null {
  const text = raw.trim().toLowerCase().replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ');
  const relative = /^(?:in|after) (.+)$/.exec(text);
  if (relative) {
    const minutes = parseDurationMinutes(relative[1]);
    return minutes === null ? null : new Date(now.getTime() + minutes * 60_000);
  }
  const at = /^(.*?)\s*\bat (.+)$/.exec(text);
  if (!at) {
    const day = parseDay(text, now);
    return day?.explicit ? resolve(day, null, now) : null;
  }
  const day = parseDay(at[1], now);
  if (!day) return null;
  const clock = parseClock(at[2]);
  if (clock) return resolve(day, clock, now);
  if (day.explicit) return null;
  const trailing = clockWithTrailingDay(at[2], now);
  return trailing ? resolve(trailing.day, trailing.clock, now) : null;
}

export interface WhenMatch {
  readonly at: Date;
  /** The words left once the time phrase is removed (e.g. the reminder text). */
  readonly rest: string;
}

/** Finds a moment phrase at the end ("X at 8") or the start ("in 10 minutes to X") of the text. */
export function extractWhen(raw: string, now: Date): WhenMatch | null {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  for (let start = 1; start < words.length; start += 1) {
    const at = parseMoment(words.slice(start).join(' '), now);
    if (at) return { at, rest: words.slice(0, start).join(' ') };
  }
  for (let end = words.length - 1; end >= 1; end -= 1) {
    const at = parseMoment(words.slice(0, end).join(' '), now);
    if (at) return { at, rest: words.slice(end).join(' ').replace(/^(?:to|that|about)\s+/i, '') };
  }
  return null;
}
