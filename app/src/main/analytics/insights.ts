/**
 * Daily aggregates and up to three plain-language observations, computed from data only.
 * Wording is descriptive and gentle — never diagnostic.
 */
import type { DynamicsSession, FogReading } from '../../shared/types';
import { median } from './baseline';

const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIOD_MIN_SESSIONS = 6;
export const PACE_DIFFERENCE = 0.15;
export const TREND_MIN_SESSIONS = 3;
export const TREND_POINTS = 8;
const MAX_INSIGHTS = 3;

export type Readings = ReadonlyMap<string, FogReading | null>;

export function localDateKey(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local dates from `days - 1` days ago through today, oldest first. */
export function dateRange(days: number, now: number): string[] {
  const today = new Date(now);
  return Array.from({ length: Math.max(1, days) }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index), 12);
    return localDateKey(date.getTime());
  });
}

/** Local midnight at the start of the window. */
export function windowStart(days: number, now: number): number {
  const today = new Date(now);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - (Math.max(1, days) - 1)).getTime();
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
const roundOrNull = (value: number | null): number | null => (value === null ? null : Math.round(value));

export function dailyAggregates(sessions: readonly DynamicsSession[], readings: Readings, days: number, now: number) {
  const byDate = new Map<string, DynamicsSession[]>();
  for (const session of sessions) {
    const key = localDateKey(Date.parse(session.createdAt));
    byDate.set(key, [...(byDate.get(key) ?? []), session]);
  }
  return dateRange(days, now).map((date) => {
    const day = byDate.get(date) ?? [];
    const fog = day.map((s) => readings.get(s.id)?.fogIndex).filter((v): v is number => v !== undefined);
    const wpm = day.map((s) => s.wpm).filter((v) => v > 0);
    return { date, fogIndex: roundOrNull(mean(fog)), wpm: roundOrNull(mean(wpm)), sessions: day.length };
  });
}

type Period = 'morning' | 'afternoon' | 'evening' | 'night';

export function periodOf(hour: number): Period {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

const PERIOD_PHRASE: Readonly<Record<Period, string>> = {
  morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night',
};

export function paceInsight(sessions: readonly DynamicsSession[]): string | null {
  const byPeriod = new Map<Period, number[]>();
  for (const session of sessions) {
    if (session.wpm <= 0) continue;
    const period = periodOf(session.hourOfDay);
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), session.wpm]);
  }
  const medians = [...byPeriod.entries()]
    .filter(([, values]) => values.length >= PERIOD_MIN_SESSIONS)
    .map(([period, values]) => ({ period, wpm: median(values) }))
    .sort((a, b) => b.wpm - a.wpm);
  if (medians.length < 2) return null;
  const fastest = medians[0];
  const slowest = medians[medians.length - 1];
  const difference = (fastest.wpm - slowest.wpm) / fastest.wpm;
  if (difference <= PACE_DIFFERENCE) return null;
  const percent = Math.round(difference * 100);
  return `You tend to speak about ${percent}% more slowly ${PERIOD_PHRASE[slowest.period]} than ${PERIOD_PHRASE[fastest.period]}.`;
}

export function trendInsight(sessions: readonly DynamicsSession[], readings: Readings, now: number): string | null {
  const fogBetween = (from: number, to: number): number[] => sessions
    .filter((s) => {
      const time = Date.parse(s.createdAt);
      return time >= from && time < to;
    })
    .map((s) => readings.get(s.id)?.fogIndex)
    .filter((v): v is number => v !== undefined);
  const thisWeek = fogBetween(now - 7 * DAY_MS, now + 1);
  const lastWeek = fogBetween(now - 14 * DAY_MS, now - 7 * DAY_MS);
  if (thisWeek.length < TREND_MIN_SESSIONS || lastWeek.length < TREND_MIN_SESSIONS) return null;
  const change = (mean(thisWeek) ?? 0) - (mean(lastWeek) ?? 0);
  if (change <= -TREND_POINTS) return 'Your speech has been flowing more easily this week than last week.';
  if (change >= TREND_POINTS) return 'Your speech has seemed a little more tired this week than last week. Go easy on yourself.';
  return 'Your speech this week has been about as steady as last week.';
}

/**
 * `sessions` is the requested window; `trendSessions` must cover at least the last 14 days so the
 * week-over-week comparison works for short windows too. `readings` must cover both.
 */
export function buildInsights(
  sessions: readonly DynamicsSession[], readings: Readings, baselineReady: boolean, now: number,
  trendSessions: readonly DynamicsSession[] = sessions,
): string[] {
  const learning = baselineReady || sessions.length === 0
    ? null
    : 'Rivertide is still learning how you usually speak. After a few more sessions it can compare your days.';
  return [learning, paceInsight(sessions), trendInsight(trendSessions, readings, now)]
    .filter((text): text is string => text !== null)
    .slice(0, MAX_INSIGHTS);
}
