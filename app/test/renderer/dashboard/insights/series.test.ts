import { describe, expect, it } from 'vitest';
import type { DynamicsSession, DynamicsSummary, UsageSummary } from '../../../../src/shared/types';
import {
  DEFAULT_RANGE, describeSeries, dynamicsSeries, fillerSeries, fogSentence, fogSeries, formatDayLabel, formatTickDate, formatValue,
  groupSessionsByDay, hasData, isRangeDays, isReadingToday, lastDefined, maxDefined, mean, modeSplit, paceSeries, parseRange,
  pausesSeries, roundTo, topApps, valueExtent, wordsSeries, type DayValue,
} from '../../../../src/renderer/dashboard/pages/insights/series';

/** A local-time ISO stamp on 2026-10-<day> so day keys never depend on the machine's time zone. */
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

function session(overrides: Partial<DynamicsSession> = {}): DynamicsSession {
  return {
    id: 's1', historyId: 'h1', createdAt: at(14), mode: 'dictate', durationMs: 60_000, speechMs: 45_000, words: 100,
    wpm: 120, pauseCount: 3, longPauseCount: 1, meanPauseMs: 700, fillerCount: 2, fillerRate: 2, repetitionCount: 0,
    selfCorrectionCount: 0, typeTokenRatio: 0.7, editRatio: 0.1, hourOfDay: 12,
    ...overrides,
  };
}

const daily = (rows: readonly [string, number | null, number | null][]): DynamicsSummary['daily'] =>
  rows.map(([date, fogIndex, wpm]) => ({ date, fogIndex, wpm, sessions: fogIndex === null ? 0 : 1 }));

describe('range parsing', () => {
  it('accepts only the offered ranges', () => {
    expect(isRangeDays(30)).toBe(true);
    expect(isRangeDays(31)).toBe(false);
  });

  it('reads a route section and falls back to the default', () => {
    expect(parseRange('90')).toBe(90);
    expect(parseRange('7')).toBe(7);
    expect(parseRange('banana')).toBe(DEFAULT_RANGE);
    expect(parseRange(null)).toBe(DEFAULT_RANGE);
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE);
  });
});

describe('number helpers', () => {
  it('averages and rounds', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNull();
    expect(roundTo(2.345)).toBe(2.3);
    expect(roundTo(2.345, 2)).toBe(2.35);
  });

  it('formats whole numbers with separators and small numbers with one decimal', () => {
    expect(formatValue(1284, false)).toBe('1,284');
    expect(formatValue(2.46, true)).toBe('2.5');
    expect(formatValue(3, true)).toBe('3');
  });

  it('formats day labels for tooltips and ticks', () => {
    expect(formatDayLabel('2026-10-15')).toBe('Thu, Oct 15');
    expect(formatTickDate('2026-10-15')).toBe('Oct 15');
  });
});

describe('groupSessionsByDay', () => {
  it('groups sessions by local calendar day, oldest first', () => {
    // Arrange
    const sessions = [session({ id: 'b', createdAt: at(14, 18) }), session({ id: 'c', createdAt: at(13) }), session({ id: 'a', createdAt: at(14, 9) })];

    // Act
    const groups = groupSessionsByDay(sessions);

    // Assert
    expect([...groups.keys()]).toEqual(['2026-10-13', '2026-10-14']);
    expect(groups.get('2026-10-14')?.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('does not reorder the input array', () => {
    // Arrange
    const sessions = [session({ id: 'late', createdAt: at(14) }), session({ id: 'early', createdAt: at(12) })];

    // Act
    groupSessionsByDay(sessions);

    // Assert
    expect(sessions.map((s) => s.id)).toEqual(['late', 'early']);
  });
});

describe('dynamics series', () => {
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14'];

  it('maps fog readings and keeps missing days as gaps', () => {
    // Arrange + Act
    const fog = fogSeries(daily([['2026-10-12', 20, 118], ['2026-10-13', null, null], ['2026-10-14', 41, 110]]));

    // Assert
    expect(fog).toEqual([{ date: '2026-10-12', value: 20 }, { date: '2026-10-13', value: null }, { date: '2026-10-14', value: 41 }]);
  });

  it('treats an unmeasured pace of zero as a gap', () => {
    // Arrange + Act
    const pace = paceSeries(daily([['2026-10-12', 20, 0], ['2026-10-13', 30, 121], ['2026-10-14', null, null]]));

    // Assert
    expect(pace.map((d) => d.value)).toEqual([null, 121, null]);
  });

  it('averages pauses per session for each day', () => {
    // Arrange
    const sessions = [session({ createdAt: at(12), pauseCount: 2 }), session({ createdAt: at(12, 15), pauseCount: 5 }), session({ createdAt: at(14), pauseCount: 4 })];

    // Act
    const pauses = pausesSeries(dates, sessions);

    // Assert
    expect(pauses.map((d) => d.value)).toEqual([3.5, null, 4]);
  });

  it('weights filler rates by words and skips sessions without words', () => {
    // Arrange
    const sessions = [
      session({ createdAt: at(12), words: 300, fillerRate: 1 }),
      session({ createdAt: at(12, 15), words: 100, fillerRate: 5 }),
      session({ createdAt: at(13), words: 0, fillerRate: 0 }),
    ];

    // Act
    const fillers = fillerSeries(dates, sessions);

    // Assert
    expect(fillers.map((d) => d.value)).toEqual([2, null, null]);
  });

  it('builds every chart series aligned to the summary days', () => {
    // Arrange
    const summary: DynamicsSummary = {
      sessions: [session({ createdAt: at(13), pauseCount: 6, fillerRate: 3 })],
      baselineReady: true,
      latest: null,
      daily: daily([['2026-10-12', null, null], ['2026-10-13', 50, 99], ['2026-10-14', null, null]]),
      insights: [],
    };

    // Act
    const series = dynamicsSeries(summary);

    // Assert
    expect(series.fog.map((d) => d.value)).toEqual([null, 50, null]);
    expect(series.pace.map((d) => d.value)).toEqual([null, 99, null]);
    expect(series.pauses.map((d) => d.value)).toEqual([null, 6, null]);
    expect(series.fillers.map((d) => d.value)).toEqual([null, 3, null]);
  });
});

describe('usage series', () => {
  const usage: UsageSummary = {
    totals: { sessions: 9, words: 1200, dictations: 6, asks: 2, commands: 1 },
    daily: [{ date: '2026-10-14', words: 400, sessions: 3 }, { date: '2026-10-15', words: 0, sessions: 0 }],
    streakDays: 3,
    topApps: [
      { name: 'Notes', count: 2 }, { name: 'Mail', count: 9 }, { name: 'Safari', count: 4 }, { name: 'Slack', count: 0 },
      { name: 'Pages', count: 1 }, { name: 'Terminal', count: 3 }, { name: 'Music', count: 1 },
    ],
  };

  it('turns daily words into a series where zero stays zero', () => {
    expect(wordsSeries(usage.daily)).toEqual([{ date: '2026-10-14', value: 400 }, { date: '2026-10-15', value: 0 }]);
  });

  it('splits sessions by mode', () => {
    expect(modeSplit(usage.totals)).toEqual([
      { label: 'Dictations', value: 6 },
      { label: 'Asks', value: 2 },
      { label: 'Commands', value: 1 },
    ]);
  });

  it('keeps the five busiest apps, most used first, without unused ones', () => {
    // Arrange + Act
    const apps = topApps(usage.topApps);

    // Assert
    expect(apps.map((a) => a.label)).toEqual(['Mail', 'Safari', 'Terminal', 'Notes', 'Pages']);
    expect(usage.topApps[0]?.name).toBe('Notes');
  });
});

describe('series queries', () => {
  const series: DayValue[] = [
    { date: '2026-10-12', value: 4 },
    { date: '2026-10-13', value: 9 },
    { date: '2026-10-14', value: 9 },
    { date: '2026-10-15', value: null },
  ];

  it('finds the latest defined day', () => {
    expect(lastDefined(series)).toEqual({ date: '2026-10-14', value: 9 });
    expect(lastDefined([{ date: '2026-10-12', value: null }])).toBeNull();
  });

  it('finds the highest day, preferring the latest on a tie', () => {
    expect(maxDefined(series)).toEqual({ date: '2026-10-14', value: 9 });
    expect(maxDefined([])).toBeNull();
  });

  it('reports the value extent', () => {
    expect(valueExtent(series)).toEqual([4, 9]);
    expect(valueExtent([{ date: '2026-10-12', value: null }])).toBeNull();
  });

  it('knows whether there is anything to draw', () => {
    expect(hasData(series)).toBe(true);
    expect(hasData([{ date: 'a', value: 0 }])).toBe(true);
    expect(hasData([{ date: 'a', value: 0 }], true)).toBe(false);
    expect(hasData([{ date: 'a', value: null }])).toBe(false);
  });

  it('describes a series for screen readers, gaps included', () => {
    // Arrange + Act
    const text = describeSeries(series, (v) => `${v} words`);

    // Assert
    expect(text).toBe('Daily values from Oct 12 to Oct 15. Highest: 9 words on Oct 14. Latest: 9 words on Oct 14. 1 day has no sessions.');
  });

  it('pluralises several gaps and handles an empty series', () => {
    // Arrange
    const gappy: DayValue[] = [{ date: '2026-10-12', value: null }, { date: '2026-10-13', value: null }, { date: '2026-10-14', value: 2 }];

    // Act + Assert
    expect(describeSeries(gappy, String)).toContain('2 days have no sessions.');
    expect(describeSeries([], String)).toBe('No sessions in this range yet.');
    expect(describeSeries([{ date: '2026-10-12', value: 3 }], String)).not.toContain('no sessions');
  });
});

describe('fogSentence', () => {
  it('reads each label gently for today', () => {
    expect(fogSentence('steady', true)).toBe('Your speech looks steady today.');
    expect(fogSentence('a-little-foggy', true)).toBe('Your speech looks a little foggier than usual today.');
    expect(fogSentence('foggy', true)).toBe('Your speech looks foggier than usual today — go easy on yourself.');
  });

  it('speaks in the past when the latest reading is from an earlier day', () => {
    expect(fogSentence('steady', false)).toBe('Your speech looked steady the last time you talked with Rivertide.');
    expect(fogSentence('foggy', false)).toContain('go easy on yourself.');
  });

  it('knows whether the latest reading is from the last day of the range', () => {
    expect(isReadingToday(daily([['2026-10-14', 30, 100], ['2026-10-15', 40, 100]]))).toBe(true);
    expect(isReadingToday(daily([['2026-10-14', 30, 100], ['2026-10-15', null, null]]))).toBe(false);
    expect(isReadingToday([])).toBe(false);
  });
});
