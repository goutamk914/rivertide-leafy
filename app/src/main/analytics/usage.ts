/**
 * Usage summary from history: totals, daily words/sessions, day streak and most-used apps.
 * Only completed ('ok') sessions count.
 */
import type { HistoryItem, UsageSummary } from '../../shared/types';
import { dateRange, localDateKey, windowStart } from './insights';

export const TOP_APPS = 5;

/** Consecutive days with at least one session, counting back from today (or yesterday). */
export function streakDays(dates: ReadonlySet<string>, now: number): number {
  const today = new Date(now);
  const keyFor = (offset: number): string =>
    localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset, 12).getTime());
  let offset = dates.has(keyFor(0)) ? 0 : 1;
  let streak = 0;
  while (dates.has(keyFor(offset))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}

export function usageSummary(history: readonly HistoryItem[], days: number, now: number): UsageSummary {
  const done = history.filter((item) => item.status === 'ok');
  const from = windowStart(days, now);
  const inWindow = done.filter((item) => Date.parse(item.createdAt) >= from);
  const daily = new Map(dateRange(days, now).map((date) => [date, { date, words: 0, sessions: 0 }]));
  const apps = new Map<string, number>();
  for (const item of inWindow) {
    const key = localDateKey(Date.parse(item.createdAt));
    const day = daily.get(key);
    if (day) daily.set(key, { date: key, words: day.words + item.words, sessions: day.sessions + 1 });
    if (item.app?.name) apps.set(item.app.name, (apps.get(item.app.name) ?? 0) + 1);
  }
  const countMode = (mode: HistoryItem['mode']): number => inWindow.filter((item) => item.mode === mode).length;
  return {
    totals: {
      sessions: inWindow.length,
      words: inWindow.reduce((sum, item) => sum + item.words, 0),
      dictations: countMode('dictate'),
      asks: countMode('ask'),
      commands: countMode('command'),
    },
    daily: [...daily.values()],
    streakDays: streakDays(new Set(done.map((item) => localDateKey(Date.parse(item.createdAt)))), now),
    topApps: [...apps.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, TOP_APPS),
  };
}
