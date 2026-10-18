/** Usage and speech-dynamics summaries computed from the mock state (rough stand-ins for main's analytics). */
import type { DynamicsSession, DynamicsSummary, FogLabel, FogReading, HistoryItem, UsageSummary } from '@shared/types';
import { dayKey } from '../format';
import { DAY } from './random';

const BASELINE_MIN_SESSIONS = 5;
const FOG_STEADY_MAX = 40; // main: analytics/baseline.ts STEADY_BELOW
const FOG_FOGGY_MIN = 65;

function lastDays(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - (days - 1 - i) * DAY)));
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

function streak(keys: readonly string[], byDay: Map<string, unknown[]>): number {
  let count = 0;
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    if (!byDay.has(keys[i] as string)) break;
    count += 1;
  }
  return count;
}

export function usageSummary(history: readonly HistoryItem[], days: number, now: Date): UsageSummary {
  const keys = lastDays(now, days);
  const inRange = history.filter((h) => keys.includes(dayKey(h.createdAt)));
  const byDay = countBy(inRange, (h) => dayKey(h.createdAt));
  const apps = countBy(inRange.filter((h) => h.app), (h) => h.app?.name ?? '');
  return {
    totals: {
      sessions: inRange.length,
      words: inRange.reduce((sum, h) => sum + h.words, 0),
      dictations: inRange.filter((h) => h.mode === 'dictate').length,
      asks: inRange.filter((h) => h.mode === 'ask').length,
      commands: inRange.filter((h) => h.mode === 'command').length,
    },
    daily: keys.map((date) => {
      const items = byDay.get(date) ?? [];
      return { date, words: items.reduce((sum, h) => sum + h.words, 0), sessions: items.length };
    }),
    streakDays: streak(keys, byDay),
    topApps: [...apps.entries()]
      .map(([name, items]) => ({ name, count: items.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function fogLabel(index: number): FogLabel {
  if (index >= FOG_FOGGY_MIN) return 'foggy';
  if (index >= FOG_STEADY_MAX) return 'a-little-foggy';
  return 'steady';
}

/** Synthetic fog index per day: a slow wave so the chart has shape. */
function dayFog(sessions: readonly DynamicsSession[], indexFromEnd: number): number | null {
  if (sessions.length === 0) return null;
  const meanWpm = sessions.reduce((s, x) => s + x.wpm, 0) / sessions.length;
  const wave = 30 + 14 * Math.sin(indexFromEnd / 3.2);
  return Math.max(0, Math.min(100, Math.round(wave + (118 - meanWpm) * 0.8)));
}

export function dynamicsSummary(dynamics: readonly DynamicsSession[], days: number, now: Date, latestOverride?: FogReading): DynamicsSummary {
  const keys = lastDays(now, days);
  const inRange = dynamics.filter((d) => keys.includes(dayKey(d.createdAt)));
  const byDay = countBy(inRange, (d) => dayKey(d.createdAt));
  const daily = keys.map((date, i) => {
    const sessions = byDay.get(date) ?? [];
    const wpm = sessions.length ? Math.round(sessions.reduce((s, x) => s + x.wpm, 0) / sessions.length) : null;
    return { date, fogIndex: dayFog(sessions, keys.length - 1 - i), wpm, sessions: sessions.length };
  });
  const baselineReady = dynamics.length >= BASELINE_MIN_SESSIONS;
  const lastWithData = [...daily].reverse().find((d) => d.fogIndex !== null);
  const latest: FogReading | null = latestOverride ?? (baselineReady && lastWithData?.fogIndex != null
    ? {
        fogIndex: lastWithData.fogIndex,
        label: fogLabel(lastWithData.fogIndex),
        contributors: [
          { metric: 'wpm', direction: 'worse', z: -0.8 },
          { metric: 'longPauseCount', direction: 'worse', z: 0.6 },
          { metric: 'fillerRate', direction: 'better', z: -0.3 },
        ],
      }
    : null);
  return {
    sessions: inRange,
    baselineReady,
    latest,
    daily,
    insights: baselineReady
      ? [
          'You tend to speak a little more slowly after 6 pm.',
          'Your pauses were shorter this week than last week.',
          'Mornings have been your clearest time of day lately.',
        ]
      : [],
  };
}
