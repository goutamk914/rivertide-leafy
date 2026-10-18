/**
 * Insights: usage stats and non-clinical speech dynamics. Listens for finished voice sessions,
 * measures the user's own words, compares them with their personal baseline, and offers a gentle
 * Leafy cue when a session reads as foggy (at most every 6 hours).
 */
import { z } from 'zod';
import type { DynamicsSession, FogReading, HistoryItem, SpeechStats } from '../../shared/types';
import type { AppContext, InsightsService } from '../services';
import { newId } from '../data/ids';
import { HISTORY_CAP } from '../data/history';
import { DynamicsSessionSchema } from '../data/schemas';
import { announceChange, errorMessage, lazyLogger, lazyStore, parseItems } from '../data/store';
import { baselineWindow, computeBaseline, readingAt } from './baseline';
import { buildInsights, dailyAggregates, windowStart } from './insights';
import { computeSessionMetrics } from './metrics';
import { usageSummary } from './usage';

interface DynamicsFile {
  readonly version: 1;
  readonly sessions: readonly DynamicsSession[];
  readonly lastFoggyCueAt: string | null;
}

export const DYNAMICS_CAP = 3000;
export const FOGGY_CUE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** A reading older than this is not "current" (calm mode shouldn't stick from last week). */
export const CURRENT_FOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The week-over-week insight always looks at the last 14 days, whatever window is shown. */
const TREND_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
export const FOGGY_CUE = { mood: 'caring', say: 'You sound a little tired. Want me to keep things simple today?', holdMs: 12_000 } as const;

const LastCueSchema = z.string().min(1).max(40).nullable().catch(null);
const byOldest = (a: DynamicsSession, b: DynamicsSession): number => a.createdAt.localeCompare(b.createdAt);

export function createInsightsService(ctx: AppContext): InsightsService {
  const log = lazyLogger(ctx, 'insights');
  const store = lazyStore<DynamicsFile>(ctx, 'dynamics', { version: 1, sessions: [], lastFoggyCueAt: null }, (raw) => ({
    version: 1,
    sessions: parseItems(raw, 'sessions', DynamicsSessionSchema, log).sort(byOldest).slice(-DYNAMICS_CAP),
    lastFoggyCueAt: LastCueSchema.parse((raw as { lastFoggyCueAt?: unknown }).lastFoggyCueAt ?? null),
  }));
  const readings = new Map<string, FogReading | null>();
  let unsubscribe: (() => void) | null = null;

  const sessions = (): readonly DynamicsSession[] => store().read().sessions;

  /** Memoised: a session's reading only depends on the (immutable) sessions before it. */
  const readingFor = (session: DynamicsSession, all: readonly DynamicsSession[], times?: readonly number[]): FogReading | null => {
    if (!readings.has(session.id)) {
      readings.set(session.id, readingAt(session, all, times ?? all.map((s) => Date.parse(s.createdAt))));
    }
    return readings.get(session.id) ?? null;
  };

  const maybeCue = (reading: FogReading | null, now: number): void => {
    if (reading?.label !== 'foggy') return;
    const last = store().read().lastFoggyCueAt;
    if (last && now - Date.parse(last) < FOGGY_CUE_COOLDOWN_MS) return;
    store().update((current) => ({ ...current, lastFoggyCueAt: new Date(now).toISOString() }));
    ctx.bus.emit('leafy:cue', { ...FOGGY_CUE });
  };

  const record = (item: HistoryItem, stats: SpeechStats | null): void => {
    if (!ctx.settings.get().insights.dynamicsEnabled || item.status !== 'ok' || !stats) return;
    if (sessions().some((session) => session.historyId === item.id)) return;
    const session = computeSessionMetrics(item, stats, newId());
    if (!session) return;
    const next = [...sessions(), session].sort(byOldest).slice(-DYNAMICS_CAP);
    store().update((current) => ({ ...current, sessions: next }));
    announceChange(ctx, 'dynamics');
    maybeCue(readingFor(session, next), Date.now());
  };

  const currentFog = (): FogReading | null => {
    const all = sessions();
    const latest = all[all.length - 1];
    if (!latest || Date.now() - Date.parse(latest.createdAt) > CURRENT_FOG_MAX_AGE_MS) return null;
    return readingFor(latest, all);
  };

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = ctx.bus.on('voice:completed', ({ item, stats }) => {
        // History off means nothing derived from the user's speech is stored.
        if (!ctx.settings.get().privacy.historyEnabled) return;
        try {
          record(item, stats);
        } catch (error) {
          log().error('Could not measure speech dynamics', { historyId: item.id, error: errorMessage(error) });
        }
      });
    },

    usage: (days) => usageSummary(ctx.history.recent(HISTORY_CAP), days, Date.now()),

    dynamics(days) {
      const now = Date.now();
      const all = sessions();
      const from = windowStart(days, now);
      const trendFrom = Math.min(from, now - TREND_SPAN_MS);
      const inWindow = all.filter((session) => Date.parse(session.createdAt) >= from);
      const forTrend = all.filter((session) => Date.parse(session.createdAt) >= trendFrom);
      const times = all.map((session) => Date.parse(session.createdAt));
      const windowReadings = new Map(forTrend.map((session) => [session.id, readingFor(session, all, times)]));
      const baselineReady = computeBaseline(baselineWindow(all, now + 1)).ready;
      return {
        sessions: inWindow,
        baselineReady,
        latest: currentFog(),
        daily: dailyAggregates(inWindow, windowReadings, days, now),
        insights: buildInsights(inWindow, windowReadings, baselineReady, now, forTrend),
      };
    },

    currentFog,
  };
}
