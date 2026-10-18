import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DynamicsSession } from '../../../src/shared/types';
import { FOGGY_CUE } from '../../../src/main/analytics';
import {
  computeBaseline, fogLabel, fogReading, lowerBound, median, medianAbsoluteDeviation, readingAt, squash,
} from '../../../src/main/analytics/baseline';
import { buildInsights, dailyAggregates, paceInsight, periodOf, trendInsight } from '../../../src/main/analytics/insights';
import {
  computeSessionMetrics, countFillers, countRepetitions, countSelfCorrections, editDistance, editRatio, movingTypeTokenRatio, wordsPerMinute,
} from '../../../src/main/analytics/metrics';
import { streakDays, usageSummary } from '../../../src/main/analytics/usage';
import { words } from '../../../src/main/knowledge/text';
import { createFakeContext, makeHistoryItem, makeStats } from '../data/fake-context';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const session = (overrides: Partial<DynamicsSession>): DynamicsSession => ({
  id: 's', historyId: 'h', createdAt: new Date(NOW).toISOString(), mode: 'dictate', durationMs: 60_000, speechMs: 50_000,
  words: 120, wpm: 140, pauseCount: 6, longPauseCount: 0, meanPauseMs: 500, fillerCount: 1, fillerRate: 1,
  repetitionCount: 0, selfCorrectionCount: 0, typeTokenRatio: 0.8, editRatio: 0.1, hourOfDay: 10, ...overrides,
});

/** Five days of steady sessions with small natural variation. */
const steadyBaseline = (end: number = NOW): DynamicsSession[] => Array.from({ length: 8 }, (_, i) => session({
  id: `b${i}`, createdAt: new Date(end - (i + 1) * 12 * HOUR).toISOString(), wpm: 140 + (i % 3) * 4,
  meanPauseMs: 480 + (i % 2) * 40, fillerRate: 1 + (i % 2) * 0.5, typeTokenRatio: 0.8 + (i % 3) * 0.01,
}));

describe('speech metrics on hand-written transcripts', () => {
  it('counts fillers, including "like" only when used as a filler', () => {
    expect(countFillers('Um, I went, like, to the uh clinic and you know it was er fine')).toBe(5);
    expect(countFillers('I like my nurse. Ahh, kind of tired. I mean it.')).toBe(3);
    expect(countFillers('The ER was busy. Hmm.')).toBe(0);
  });

  it('counts immediate word and pair repetitions', () => {
    expect(countRepetitions(words('I I think the the the dose'))).toBe(3);
    expect(countRepetitions(words('I went I went to the clinic'))).toBe(1);
    expect(countRepetitions(words('no repeats here at all'))).toBe(0);
  });

  it('counts self-corrections', () => {
    expect(countSelfCorrections('Tuesday, no wait, Wednesday. Actually Thursday, sorry. Scratch that. Let me rephrase.')).toBe(5);
    expect(countSelfCorrections('No, wait for me')).toBe(1);
    expect(countSelfCorrections('Everything is fine')).toBe(0);
  });

  it('computes a moving type-token ratio', () => {
    expect(movingTypeTokenRatio([])).toBe(0);
    expect(movingTypeTokenRatio(['a', 'b', 'a', 'b'])).toBe(0.5);
    const varied = Array.from({ length: 60 }, (_, i) => `w${i}`);
    const repetitive = Array.from({ length: 60 }, (_, i) => `w${i % 5}`);
    expect(movingTypeTokenRatio(varied)).toBe(1);
    expect(movingTypeTokenRatio(repetitive)).toBeCloseTo(0.2);
  });

  it('computes word-level edit ratio and guards tiny timings for wpm', () => {
    expect(editDistance(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toBe(2);
    expect(editRatio('um so I went to the the store', 'So I went to the store.')).toBeCloseTo(2 / 8);
    expect(editRatio('', 'x')).toBe(0);
    expect(wordsPerMinute(100, makeStats({ speechMs: 30_000 }))).toBe(200);
    expect(wordsPerMinute(10, makeStats({ speechMs: 200, durationMs: 6000 }))).toBe(100);
    expect(wordsPerMinute(10, makeStats({ speechMs: 100, durationMs: 500 }))).toBe(0);
    expect(wordsPerMinute(100, makeStats({ speechMs: 5000 }))).toBe(0);
  });

  it('builds a session only from the raw words, with editRatio for dictation only', () => {
    // Arrange
    const item = makeHistoryItem({ raw: 'um I I need to call the the nurse, no wait, the doctor', output: 'I need to call the doctor.', mode: 'dictate', createdAt: '2026-10-15T09:30:00' });

    // Act
    const metrics = computeSessionMetrics(item, makeStats({ speechMs: 6000 }), 'dyn1');
    const asked = computeSessionMetrics({ ...item, mode: 'ask' }, makeStats(), 'dyn2');

    // Assert
    expect(metrics).toMatchObject({ id: 'dyn1', historyId: item.id, words: 13, wpm: 130, fillerCount: 1, repetitionCount: 2, selfCorrectionCount: 1, hourOfDay: 9 });
    expect(metrics?.editRatio).toBeGreaterThan(0);
    expect(asked?.editRatio).toBe(0);
    expect(computeSessionMetrics(makeHistoryItem({ raw: 'open mail' }), makeStats(), 'x')).toBeNull();
  });
});

describe('baseline and fog index', () => {
  it('computes robust statistics', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 100])).toBe(1);
    expect(lowerBound([1, 3, 5], 4)).toBe(2);
  });

  it('is not ready with fewer than 5 sessions', () => {
    const baseline = computeBaseline(steadyBaseline().slice(0, 4));
    expect(baseline.ready).toBe(false);
    expect(fogReading(session({}), baseline)).toBeNull();
  });

  it('labels thresholds: steady < 40 ≤ a little foggy < 65 ≤ foggy', () => {
    expect(fogLabel(39)).toBe('steady');
    expect(fogLabel(40)).toBe('a-little-foggy');
    expect(fogLabel(64)).toBe('a-little-foggy');
    expect(fogLabel(65)).toBe('foggy');
    expect(squash(0)).toBeLessThan(40);
    expect(squash(2)).toBeGreaterThanOrEqual(65);
  });

  it('reads a typical session as steady and a slow, halting one as foggy', () => {
    // Arrange
    const baseline = computeBaseline(steadyBaseline());
    const typical = session({ id: 'now1', wpm: 144, meanPauseMs: 500, fillerRate: 1.2 });
    const foggy = session({ id: 'now2', wpm: 90, pauseCount: 20, meanPauseMs: 1400, fillerRate: 8, selfCorrectionCount: 6, typeTokenRatio: 0.6 });

    // Act
    const typicalReading = fogReading(typical, baseline);
    const foggyReading = fogReading(foggy, baseline);

    // Assert
    expect(typicalReading?.label).toBe('steady');
    expect(foggyReading?.label).toBe('foggy');
    expect(foggyReading?.contributors[0]).toMatchObject({ direction: 'worse' });
    expect(foggyReading?.contributors.length).toBeLessThanOrEqual(3);
  });

  it('uses only sessions from the 14 days before the session', () => {
    const history = [...steadyBaseline(NOW - 20 * DAY), session({ id: 'late', createdAt: new Date(NOW).toISOString() })];
    const times = history.map((s) => Date.parse(s.createdAt)).sort((a, b) => a - b);
    const sorted = [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    expect(readingAt(history[history.length - 1], sorted, times)).toBeNull();
  });
});

describe('insights', () => {
  it('describes time-of-day pace differences over 15% with at least 6 sessions each', () => {
    // Arrange
    const morning = Array.from({ length: 6 }, (_, i) => session({ id: `m${i}`, hourOfDay: 9, wpm: 150 }));
    const evening = Array.from({ length: 6 }, (_, i) => session({ id: `e${i}`, hourOfDay: 19, wpm: 120 }));

    // Act
    const insight = paceInsight([...morning, ...evening]);

    // Assert
    expect(insight).toBe('You tend to speak about 20% more slowly in the evening than in the morning.');
    expect(paceInsight([...morning, ...evening.slice(0, 5)])).toBeNull();
    expect(paceInsight([...morning, ...morning.map((s) => ({ ...s, id: `x${s.id}`, hourOfDay: 14, wpm: 140 }))])).toBeNull();
    expect(periodOf(23)).toBe('night');
  });

  it('describes improving, worsening and steady weeks from fog readings', () => {
    // Arrange
    const make = (offsetDays: number, fog: number, i: number) => ({ s: session({ id: `t${offsetDays}-${i}`, createdAt: new Date(NOW - offsetDays * DAY).toISOString() }), fog });
    const build = (thisWeek: number, lastWeek: number) => {
      const entries = [0, 1, 2].flatMap((i) => [make(i + 1, thisWeek, i), make(i + 8, lastWeek, i)]);
      return { sessions: entries.map((e) => e.s), readings: new Map(entries.map((e) => [e.s.id, { fogIndex: e.fog, label: fogLabel(e.fog), contributors: [] }])) };
    };

    // Act
    const better = build(20, 50);
    const worse = build(60, 30);
    const same = build(30, 32);

    // Assert
    expect(trendInsight(better.sessions, better.readings, NOW)).toMatch(/more easily this week/);
    expect(trendInsight(worse.sessions, worse.readings, NOW)).toMatch(/a little more tired/);
    expect(trendInsight(same.sessions, same.readings, NOW)).toMatch(/about as steady/);
    expect(trendInsight([], new Map(), NOW)).toBeNull();
  });

  it('explains that the baseline is still learning, and never uses diagnostic words', () => {
    const insights = buildInsights([session({})], new Map(), false, NOW);
    expect(insights).toEqual(['Rivertide is still learning how you usually speak. After a few more sessions it can compare your days.']);
    expect(buildInsights([], new Map(), false, NOW)).toEqual([]);
    expect(insights.join(' ')).not.toMatch(/diagnos|disease|impair|decline/i);
  });

  it('aggregates by local day across the whole window', () => {
    const sessions = [session({ id: 'a', wpm: 100 }), session({ id: 'b', wpm: 120 })];
    const daily = dailyAggregates(sessions, new Map([['a', { fogIndex: 30, label: 'steady' as const, contributors: [] }]]), 3, NOW);
    expect(daily).toHaveLength(3);
    expect(daily[2]).toMatchObject({ wpm: 110, fogIndex: 30, sessions: 2 });
    expect(daily[0]).toMatchObject({ wpm: null, fogIndex: null, sessions: 0 });
  });
});

describe('usage', () => {
  it('totals completed sessions, words per day, streak and top apps', () => {
    // Arrange
    const items = [
      makeHistoryItem({ createdAt: new Date(NOW).toISOString(), mode: 'dictate', words: 10, app: { name: 'Mail', bundleId: 'm' } }),
      makeHistoryItem({ createdAt: new Date(NOW - DAY).toISOString(), mode: 'ask', words: 5, app: { name: 'Mail', bundleId: 'm' } }),
      makeHistoryItem({ createdAt: new Date(NOW - 2 * DAY).toISOString(), mode: 'command', words: 3, app: null }),
      makeHistoryItem({ createdAt: new Date(NOW).toISOString(), status: 'error', words: 99 }),
      makeHistoryItem({ createdAt: new Date(NOW - 40 * DAY).toISOString(), words: 50 }),
    ];

    // Act
    const usage = usageSummary(items, 7, NOW);

    // Assert
    expect(usage.totals).toEqual({ sessions: 3, words: 18, dictations: 1, asks: 1, commands: 1 });
    expect(usage.daily).toHaveLength(7);
    expect(usage.daily[6]).toMatchObject({ words: 10, sessions: 1 });
    expect(usage.streakDays).toBe(3);
    expect(usage.topApps).toEqual([{ name: 'Mail', count: 2 }]);
  });

  it('keeps a streak alive when today has no session yet', () => {
    const yesterday = new Date(NOW - DAY);
    const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    expect(streakDays(new Set([key]), NOW)).toBe(1);
    expect(streakDays(new Set(), NOW)).toBe(0);
  });
});

describe('insights service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const FOGGY_RAW = 'um I I uh need to, like, um call the the uh nurse no wait the uh doctor um about the the uh thing sorry';

  it('records sessions from voice:completed and offers a caring cue for a foggy reading at most every 6 hours', () => {
    // Arrange
    const { ctx, bus, of } = createFakeContext({ seed: { dynamics: { version: 1, sessions: steadyBaseline(), lastFoggyCueAt: null } } });
    ctx.insights.start();
    ctx.insights.start();
    const foggyItem = () => makeHistoryItem({ raw: FOGGY_RAW, createdAt: new Date(Date.now()).toISOString() });
    const slowStats = makeStats({ speechMs: 30_000, durationMs: 40_000, pauseCount: 14, meanPauseMs: 1500 });

    // Act
    bus.emit('voice:completed', { item: foggyItem(), stats: slowStats });
    vi.setSystemTime(NOW + HOUR);
    bus.emit('voice:completed', { item: foggyItem(), stats: slowStats });
    vi.setSystemTime(NOW + 7 * HOUR);
    bus.emit('voice:completed', { item: foggyItem(), stats: slowStats });

    // Assert
    expect(of('leafy:cue')).toEqual([{ ...FOGGY_CUE }, { ...FOGGY_CUE }]);
    expect(ctx.insights.currentFog()?.label).toBe('foggy');
    expect(of('data:changed')).toContainEqual({ domain: 'dynamics' });
  });

  it('ignores disabled dynamics, failed items, missing stats, short items and duplicates', () => {
    // Arrange
    const { ctx, bus } = createFakeContext();
    const off = createFakeContext({ settings: { insights: { dynamicsEnabled: false } } });
    ctx.insights.start();
    off.ctx.insights.start();
    const item = makeHistoryItem({ raw: 'this is a perfectly normal dictation about my day' });

    // Act
    off.bus.emit('voice:completed', { item, stats: makeStats() });
    bus.emit('voice:completed', { item: { ...item, status: 'error' }, stats: makeStats() });
    bus.emit('voice:completed', { item, stats: null });
    bus.emit('voice:completed', { item: makeHistoryItem({ raw: 'open mail' }), stats: makeStats() });
    bus.emit('voice:completed', { item, stats: makeStats() });
    bus.emit('voice:completed', { item, stats: makeStats() });

    // Assert
    expect(ctx.insights.dynamics(7).sessions).toHaveLength(1);
    expect(off.ctx.insights.dynamics(7).sessions).toHaveLength(0);
  });

  it('summarises dynamics with baseline readiness, daily rows and insights', () => {
    // Arrange
    const { ctx } = createFakeContext({ seed: { dynamics: { version: 1, sessions: steadyBaseline(), lastFoggyCueAt: null } } });

    // Act
    const summary = ctx.insights.dynamics(14);

    // Assert
    expect(summary.sessions).toHaveLength(8);
    expect(summary.baselineReady).toBe(true);
    expect(summary.daily).toHaveLength(14);
    expect(summary.latest).not.toBeNull();
    expect(Array.isArray(summary.insights)).toBe(true);
  });

  it('compares this week with last week even when only 7 days are shown', () => {
    // Arrange
    const sessions = Array.from({ length: 40 }, (_, i) => session({
      id: `w${String(i).padStart(2, '0')}`, createdAt: new Date(NOW - (40 - i) * 12 * HOUR).toISOString(), wpm: 140 + (i % 3) * 4,
    }));
    const { ctx } = createFakeContext({ seed: { dynamics: { version: 1, sessions, lastFoggyCueAt: null } } });

    // Act
    const summary = ctx.insights.dynamics(7);

    // Assert
    expect(summary.daily).toHaveLength(7);
    expect(summary.insights).toContain('Your speech this week has been about as steady as last week.');
  });

  it('reports no current fog when the latest session is over a day old', () => {
    const { ctx } = createFakeContext({ seed: { dynamics: { version: 1, sessions: steadyBaseline(NOW - 3 * DAY), lastFoggyCueAt: null } } });
    expect(ctx.insights.currentFog()).toBeNull();
  });

  it('summarises usage from history', () => {
    const { ctx } = createFakeContext();
    ctx.history.add(makeHistoryItem({ createdAt: new Date(NOW).toISOString(), words: 12 }));
    expect(ctx.insights.usage(7).totals.words).toBe(12);
  });
});
