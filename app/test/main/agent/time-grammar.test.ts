import { describe, expect, it } from 'vitest';
import { extractWhen, parseClock, parseDurationMinutes, parseMoment, parseNumberWords } from '../../../src/main/agent/time-grammar';

// Thursday 15 October 2026, 2:03 PM local.
const NOW = new Date(2026, 9, 15, 14, 3, 0);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0).getTime();

describe('parseNumberWords', () => {
  it.each([['25', 25], ['2.5', 2.5], ['twenty five', 25], ['twenty-five', 25], ['a', 1], ['an', 1], ['a couple of', 2], ['twelve', 12], ['hundred', 100], ['two hundred', 200]])(
    '"%s" → %d', (text, value) => expect(parseNumberWords(text)).toBe(value),
  );

  it('rejects non-numbers', () => {
    expect(parseNumberWords('banana')).toBeNull();
    expect(parseNumberWords('twenty banana')).toBeNull();
  });
});

describe('parseDurationMinutes', () => {
  it.each([
    ['10 minutes', 10], ['an hour', 60], ['1 hour and 30 minutes', 90], ['an hour and a half', 90], ['half an hour', 30],
    ['90 seconds', 1.5], ['two hours', 120], ['5 min', 5], ['a minute and a half', 1.5], ['quarter of an hour', 15],
  ])('"%s" → %d minutes', (text, minutes) => expect(parseDurationMinutes(text)).toBe(minutes));

  it.each(['the laundry', '10 minutes for pasta', '', 'later'])('"%s" is not a pure duration', (text) => {
    expect(parseDurationMinutes(text)).toBeNull();
  });
});

describe('parseClock', () => {
  it.each([
    ['8', { hour: 8, minute: 0, meridiem: null }], ['8:30', { hour: 8, minute: 30, meridiem: null }],
    ['8:30 pm', { hour: 8, minute: 30, meridiem: 'pm' }], ['8 30 p.m.', { hour: 8, minute: 30, meridiem: 'pm' }],
    ["8 o'clock", { hour: 8, minute: 0, meridiem: null }], ['noon', { hour: 12, minute: 0, meridiem: 'pm' }],
    ['20:15', { hour: 20, minute: 15, meridiem: null }], ['half past 4', { hour: 4, minute: 30, meridiem: null }],
  ])('"%s"', (text, clock) => expect(parseClock(text)).toEqual(clock));

  it.each(['25:00', '13 pm', '8:75', 'eight-ish'])('rejects "%s"', (text) => expect(parseClock(text)).toBeNull());
});

describe('parseMoment', () => {
  it.each([
    ['in 20 minutes', NOW.getTime() + 20 * 60_000],
    ['at 8', at(15, 20)], // next 8 o'clock after 2:03 PM is 8 PM today
    ['at 2', at(16, 2)], // 2 PM has passed, 2 AM tomorrow is next
    ['at 8 am', at(16, 8)],
    ['at 8:30 pm', at(15, 20, 30)],
    ['tomorrow at 9', at(16, 9)],
    ['tomorrow at 3', at(16, 15)],
    ['tomorrow', at(16, 9)],
    ['tonight', at(15, 20)],
    ['this evening', at(15, 18)],
    ['on friday at 3', at(16, 15)],
    ['monday morning', at(19, 9)],
    ['thursday at 9', at(22, 9)], // today's 9 AM has passed → next week
    ['at noon', at(16, 12)],
    ['at 8:30 pm tonight', at(15, 20, 30)],
  ])('"%s"', (text, expected) => expect(parseMoment(text, NOW)?.getTime()).toBe(expected));

  it.each(['this morning', 'today at 9 am', 'whenever', 'at banana', 'in a while'])('"%s" is not a usable moment', (text) => {
    expect(parseMoment(text, NOW)).toBeNull();
  });
});

describe('extractWhen', () => {
  it('finds a trailing time phrase', () => {
    expect(extractWhen('take my pills at 8', NOW)).toEqual({ at: new Date(at(15, 20)), rest: 'take my pills' });
  });

  it('finds a leading time phrase and drops the joining "to"', () => {
    expect(extractWhen('in 10 minutes to check the oven', NOW)).toEqual({ at: new Date(NOW.getTime() + 600_000), rest: 'check the oven' });
  });

  it('returns null when there is no time', () => {
    expect(extractWhen('call my mom', NOW)).toBeNull();
  });
});
