/**
 * Data shaping for the Insights page: turns the usage and speech-dynamics summaries into
 * per-day series, plus the plain-language copy that goes with them. Pure and unit-tested.
 */
import type { DynamicsSession, DynamicsSummary, FogLabel, UsageSummary } from '@shared/types';
import { dateFromKey, dayKey, formatCount, formatShortDate } from '../../../lib/format';

export const RANGE_OPTIONS = [7, 14, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];
export const DEFAULT_RANGE: RangeDays = 14;

/** Upper edge of the "Your usual range" band on the fog chart; matches main's STEADY_BELOW (analytics/baseline.ts). */
export const FOG_STEADY_MAX = 40;
export const FOG_DOMAIN = [0, 100] as const;
export const TOP_APPS_LIMIT = 5;

const LOCALE = 'en-US';
const DECIMALS = 1;
const DAY_LABEL = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' });
const DECIMAL = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: DECIMALS });

/** One day on a chart. `null` means no sessions that day: drawn as a gap, never as zero. */
export interface DayValue {
  readonly date: string;
  readonly value: number | null;
}

export interface LabelledCount {
  readonly label: string;
  readonly value: number;
}

export function isRangeDays(value: number): value is RangeDays {
  return (RANGE_OPTIONS as readonly number[]).includes(value);
}

/** Reads a range from a route section such as "/insights/30"; anything else gives the default. */
export function parseRange(section: string | null | undefined): RangeDays {
  const value = Number(section);
  return isRangeDays(value) ? value : DEFAULT_RANGE;
}

export function roundTo(value: number, digits: number = DECIMALS): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sessions keyed by local calendar day ("2026-10-15"), oldest first within a day. */
export function groupSessionsByDay(sessions: readonly DynamicsSession[]): ReadonlyMap<string, readonly DynamicsSession[]> {
  const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups = new Map<string, readonly DynamicsSession[]>();
  for (const session of sorted) {
    const key = dayKey(session.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return groups;
}

function perDay(
  dates: readonly string[],
  sessions: readonly DynamicsSession[],
  reduce: (day: readonly DynamicsSession[]) => number | null,
): DayValue[] {
  const byDay = groupSessionsByDay(sessions);
  return dates.map((date) => {
    const day = byDay.get(date) ?? [];
    return { date, value: day.length > 0 ? reduce(day) : null };
  });
}

export function fogSeries(daily: DynamicsSummary['daily']): DayValue[] {
  return daily.map((d) => ({ date: d.date, value: d.fogIndex }));
}

/** Words per minute of speech; a zero means the pace could not be measured, so it is a gap. */
export function paceSeries(daily: DynamicsSummary['daily']): DayValue[] {
  return daily.map((d) => ({ date: d.date, value: d.wpm !== null && d.wpm > 0 ? d.wpm : null }));
}

/** Average pauses per session on each day. */
export function pausesSeries(dates: readonly string[], sessions: readonly DynamicsSession[]): DayValue[] {
  return perDay(dates, sessions, (day) => {
    const avg = mean(day.map((s) => s.pauseCount));
    return avg === null ? null : roundTo(avg);
  });
}

/** Filler words per 100 words on each day, weighted by how many words each session had. */
export function fillerSeries(dates: readonly string[], sessions: readonly DynamicsSession[]): DayValue[] {
  return perDay(dates, sessions, (day) => {
    const spoken = day.filter((s) => s.words > 0);
    const words = spoken.reduce((sum, s) => sum + s.words, 0);
    if (words === 0) return null;
    return roundTo(spoken.reduce((sum, s) => sum + s.fillerRate * s.words, 0) / words);
  });
}

export interface DynamicsSeries {
  readonly fog: readonly DayValue[];
  readonly pace: readonly DayValue[];
  readonly pauses: readonly DayValue[];
  readonly fillers: readonly DayValue[];
}

/** Every speech-dynamics chart series, all aligned to the summary's day range. */
export function dynamicsSeries(summary: DynamicsSummary): DynamicsSeries {
  const dates = summary.daily.map((d) => d.date);
  return {
    fog: fogSeries(summary.daily),
    pace: paceSeries(summary.daily),
    pauses: pausesSeries(dates, summary.sessions),
    fillers: fillerSeries(dates, summary.sessions),
  };
}

export function wordsSeries(daily: UsageSummary['daily']): DayValue[] {
  return daily.map((d) => ({ date: d.date, value: d.words }));
}

export function definedValues(series: readonly DayValue[]): number[] {
  return series.flatMap((d) => (d.value === null ? [] : [d.value]));
}

export function hasData(series: readonly DayValue[], ignoreZero = false): boolean {
  return series.some((d) => d.value !== null && (!ignoreZero || d.value !== 0));
}

/** The most recent day that has a value. */
export function lastDefined(series: readonly DayValue[]): DayValue | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const day = series[i];
    if (day && day.value !== null) return day;
  }
  return null;
}

/** The highest day (the latest one wins a tie). */
export function maxDefined(series: readonly DayValue[]): DayValue | null {
  return series.reduce<DayValue | null>((best, day) => {
    if (day.value === null) return best;
    return best === null || best.value === null || day.value >= best.value ? day : best;
  }, null);
}

export function valueExtent(series: readonly DayValue[]): readonly [number, number] | null {
  const values = definedValues(series);
  if (values.length === 0) return null;
  return [Math.min(...values), Math.max(...values)];
}

const SENTENCE_STATE: Readonly<Record<FogLabel, { readonly today: string; readonly earlier: string; readonly tail: string }>> = {
  steady: { today: 'looks steady', earlier: 'looked steady', tail: '' },
  'a-little-foggy': { today: 'looks a little foggier than usual', earlier: 'looked a little foggier than usual', tail: '' },
  foggy: { today: 'looks foggier than usual', earlier: 'looked foggier than usual', tail: ' — go easy on yourself' },
};

/** The gentle one-line reading, e.g. "Your speech looks steady today." */
export function fogSentence(label: FogLabel, isToday: boolean): string {
  const state = SENTENCE_STATE[label];
  const when = isToday ? `${state.today} today` : `${state.earlier} the last time you talked with Rivertide`;
  return `Your speech ${when}${state.tail}.`;
}

/** "Thu, Oct 15". */
export function formatDayLabel(date: string): string {
  return DAY_LABEL.format(dateFromKey(date));
}

/** "Oct 15", for axis ticks. */
export function formatTickDate(date: string): string {
  return formatShortDate(dateFromKey(date));
}

/** Whole numbers with separators ("1,284"); smaller numbers keep one decimal ("2.5"). */
export function formatValue(value: number, decimals: boolean): string {
  return decimals ? DECIMAL.format(value) : formatCount(value);
}

/** One-paragraph summary of a series for the chart's <desc>. */
export function describeSeries(series: readonly DayValue[], format: (value: number) => string): string {
  const first = series[0];
  const last = series[series.length - 1];
  const latest = lastDefined(series);
  const highest = maxDefined(series);
  if (!first || !last || !latest || !highest) return 'No sessions in this range yet.';
  const gaps = series.filter((d) => d.value === null).length;
  const parts = [
    `Daily values from ${formatTickDate(first.date)} to ${formatTickDate(last.date)}.`,
    `Highest: ${format(highest.value ?? 0)} on ${formatTickDate(highest.date)}.`,
    `Latest: ${format(latest.value ?? 0)} on ${formatTickDate(latest.date)}.`,
  ];
  if (gaps > 0) parts.push(`${gaps === 1 ? '1 day has' : `${gaps} days have`} no sessions.`);
  return parts.join(' ');
}

export function modeSplit(totals: UsageSummary['totals']): LabelledCount[] {
  return [
    { label: 'Dictations', value: totals.dictations },
    { label: 'Asks', value: totals.asks },
    { label: 'Commands', value: totals.commands },
  ];
}

/** The busiest apps, most used first, capped at five. */
export function topApps(apps: UsageSummary['topApps'], limit: number = TOP_APPS_LIMIT): LabelledCount[] {
  return [...apps]
    .filter((app) => app.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((app) => ({ label: app.name, value: app.count }));
}

/** True when the latest fog reading belongs to the final day of the range (main's "today"). */
export function isReadingToday(daily: DynamicsSummary['daily']): boolean {
  const latest = lastDefined(fogSeries(daily));
  const end = daily[daily.length - 1];
  return latest !== null && end !== undefined && latest.date === end.date;
}
