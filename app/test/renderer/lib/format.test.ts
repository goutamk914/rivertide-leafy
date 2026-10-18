import { describe, expect, it } from 'vitest';
import {
  acceleratorToKeys, acceleratorToSpeech, countWords, dateFromKey, dayKey, firstLine, formatChars, formatClock,
  formatCompact, formatCount, formatDateTime, formatDayHeading, formatDuration, formatRelative, formatShortDate, greeting,
  groupByDay, pluralize,
} from '../../../src/renderer/lib/format';

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('numbers and words', () => {
  it('formats counts with separators and compacts big numbers', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCompact(9999)).toBe('9,999');
    expect(formatCompact(12_900)).toBe('12.9K');
    expect(formatCompact(4_200_000)).toBe('4.2M');
  });

  it('pluralizes with the count', () => {
    expect(pluralize(1, 'word')).toBe('1 word');
    expect(pluralize(3, 'word')).toBe('3 words');
    expect(pluralize(2, 'person', 'people')).toBe('2 people');
  });

  it('counts words and trims first lines', () => {
    expect(countWords('  hello   there\nfriend ')).toBe(3);
    expect(countWords('   ')).toBe(0);
    expect(firstLine('\n  First line \nsecond')).toBe('First line');
    expect(firstLine('abcdefghij', 5)).toBe('abcd…');
    expect(firstLine('')).toBe('');
  });

  it('describes text sizes', () => {
    expect(formatChars(1)).toBe('1 character');
    expect(formatChars(820)).toBe('820 characters');
    expect(formatChars(12_400)).toBe('12.4K characters');
  });
});

describe('durations', () => {
  it('formats short, medium and long durations', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(3000)).toBe('3 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(3_780_000)).toBe('1 h 3 min');
    expect(formatDuration(7_200_000)).toBe('2 h');
  });

  it('shows a dash for missing values', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('dates', () => {
  const now = local(2026, 10, 15, 15, 0);

  it('builds and parses local day keys', () => {
    expect(dayKey(local(2026, 1, 5))).toBe('2026-01-05');
    expect(dateFromKey('2026-01-05').getDate()).toBe(5);
  });

  it('labels days relative to now', () => {
    expect(formatDayHeading(local(2026, 10, 15, 8), now)).toBe('Today');
    expect(formatDayHeading(local(2026, 10, 14, 23), now)).toBe('Yesterday');
    expect(formatDayHeading(local(2026, 10, 16, 1), now)).toBe('Tomorrow');
    expect(formatDayHeading(local(2026, 10, 12), now)).toBe('Monday, October 12');
    expect(formatDayHeading(local(2025, 10, 12), now)).toBe('Sunday, October 12, 2025');
  });

  it('formats clock times and short dates', () => {
    expect(formatClock(local(2026, 10, 15, 14, 3))).toBe('2:03 PM');
    expect(formatShortDate(local(2026, 10, 12))).toBe('Oct 12');
    expect(formatDateTime(local(2026, 10, 12, 9, 30), now)).toBe('Oct 12, 9:30 AM');
    expect(formatDateTime(local(2025, 10, 12, 9, 30), now)).toBe('Oct 12, 2025, 9:30 AM');
  });

  it('says relative times plainly', () => {
    expect(formatRelative(new Date(now.getTime() - 10_000), now)).toBe('just now');
    expect(formatRelative(new Date(now.getTime() + 5 * 60_000), now)).toBe('in 5 minutes');
    expect(formatRelative(new Date(now.getTime() - 2 * 3_600_000), now)).toBe('2 hours ago');
    expect(formatRelative(new Date(now.getTime() - 3 * 86_400_000), now)).toBe('3 days ago');
  });

  it('greets by time of day', () => {
    expect(greeting(6)).toBe('Good morning');
    expect(greeting(13)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
    expect(greeting(2)).toBe('Good evening');
  });

  it('groups consecutive items by local day', () => {
    // Arrange
    const items = [local(2026, 10, 15, 10), local(2026, 10, 15, 9), local(2026, 10, 13, 9)].map((d) => ({ at: d.toISOString() }));

    // Act
    const groups = groupByDay(items, (i) => i.at, now);

    // Assert
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([['Today', 2], ['Tuesday, October 13', 1]]);
  });
});

describe('accelerators', () => {
  it('shows mac symbols', () => {
    expect(acceleratorToKeys('CommandOrControl+Shift+Space')).toEqual(['⌘', '⇧', 'Space']);
    expect(acceleratorToKeys('Alt+k')).toEqual(['⌥', 'K']);
  });

  it('shows words on other platforms', () => {
    expect(acceleratorToKeys('CommandOrControl+Shift+L', 'win32')).toEqual(['Ctrl', 'Shift', 'L']);
    expect(acceleratorToKeys('Super+D', 'linux')).toEqual(['Win', 'D']);
  });

  it('reads accelerators aloud', () => {
    expect(acceleratorToSpeech('CommandOrControl+Shift+Space')).toBe('Command Shift Space');
    expect(acceleratorToSpeech('Control+Alt+X')).toBe('Control Option X');
    expect(acceleratorToKeys('')).toEqual([]);
  });
});
